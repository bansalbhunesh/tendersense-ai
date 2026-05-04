package revocation

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"time"

	"github.com/redis/go-redis/v9"
)

// optionalRDB accelerates jti lookups when REDIS_URL is configured (see main.go).
var optionalRDB *redis.Client

const (
	jtiRevKeyPrefix = "ts:jti_rev:"
	jtiOkKeyPrefix  = "ts:jti_ok:"
)

// SetOptionalRedis wires Redis for short-lived negative/positive caches around
// revoked_access_jti. Safe to call with nil to disable.
func SetOptionalRedis(c *redis.Client) {
	optionalRDB = c
}

func jtiRevKey(jti string) string { return jtiRevKeyPrefix + jti }
func jtiOkKey(jti string) string  { return jtiOkKeyPrefix + jti }

func clampTTL(d time.Duration) time.Duration {
	if d <= 0 {
		return 5 * time.Second
	}
	if d > 24*time.Hour {
		return 24 * time.Hour
	}
	return d
}

// RevokeAccessJTI records a revoked access-token jti until exp (typically the
// token's own expiry). Idempotent for the same jti.
func RevokeAccessJTI(ctx context.Context, db *sql.DB, jti string, exp time.Time) error {
	if db == nil || jti == "" {
		return nil
	}
	if exp.IsZero() {
		exp = time.Now().Add(24 * time.Hour)
	}
	_, err := db.ExecContext(ctx,
		`INSERT INTO revoked_access_jti (jti, expires_at) VALUES ($1, $2)
		 ON CONFLICT (jti) DO UPDATE SET expires_at = GREATEST(revoked_access_jti.expires_at, EXCLUDED.expires_at)`,
		jti, exp.UTC())
	if err != nil {
		return err
	}
	if optionalRDB != nil {
		ttl := clampTTL(time.Until(exp.UTC()))
		_ = optionalRDB.Set(ctx, jtiRevKey(jti), "1", ttl).Err()
		_ = optionalRDB.Del(ctx, jtiOkKey(jti)).Err()
	}
	return nil
}

// AccessJTIRevoked reports whether jti is in the revocation table.
func AccessJTIRevoked(ctx context.Context, db *sql.DB, jti string) (bool, error) {
	if db == nil || jti == "" {
		return false, nil
	}
	rdb := optionalRDB
	if rdb != nil {
		n, err := rdb.Exists(ctx, jtiRevKey(jti)).Result()
		if err == nil && n == 1 {
			return true, nil
		}
		n, err = rdb.Exists(ctx, jtiOkKey(jti)).Result()
		if err == nil && n == 1 {
			return false, nil
		}
	}
	var expAt time.Time
	err := db.QueryRowContext(ctx, `SELECT expires_at FROM revoked_access_jti WHERE jti = $1 LIMIT 1`, jti).Scan(&expAt)
	if errors.Is(err, sql.ErrNoRows) {
		if rdb != nil {
			_ = rdb.Set(ctx, jtiOkKey(jti), "1", 25*time.Second).Err()
		}
		return false, nil
	}
	if err != nil {
		return false, err
	}
	if rdb != nil {
		ttl := clampTTL(time.Until(expAt.UTC()))
		_ = rdb.Set(ctx, jtiRevKey(jti), "1", ttl).Err()
		_ = rdb.Del(ctx, jtiOkKey(jti)).Err()
	}
	return true, nil
}

// DeleteExpired removes stale revocation rows (safe to call periodically).
func DeleteExpired(ctx context.Context, db *sql.DB) error {
	if db == nil {
		return nil
	}
	_, err := db.ExecContext(ctx, `DELETE FROM revoked_access_jti WHERE expires_at < now()`)
	return err
}

// StartCleanupLoop runs DeleteExpired on an interval until the process exits.
func StartCleanupLoop(db *sql.DB, interval time.Duration) {
	if db == nil || interval <= 0 {
		return
	}
	go func() {
		t := time.NewTicker(interval)
		defer t.Stop()
		for range t.C {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			err := DeleteExpired(ctx, db)
			cancel()
			if err != nil {
				log.Printf("revocation cleanup: %v", err)
			}
		}
	}()
}
