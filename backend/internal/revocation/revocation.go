package revocation

import (
	"context"
	"database/sql"
	"log"
	"time"
)

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
	return err
}

// AccessJTIRevoked reports whether jti is in the revocation table.
func AccessJTIRevoked(ctx context.Context, db *sql.DB, jti string) (bool, error) {
	if db == nil || jti == "" {
		return false, nil
	}
	var one int
	err := db.QueryRowContext(ctx, `SELECT 1 FROM revoked_access_jti WHERE jti = $1 LIMIT 1`, jti).Scan(&one)
	if err == sql.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
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
