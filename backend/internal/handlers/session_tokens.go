package handlers

import (
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"time"

	"github.com/tendersense/backend/internal/middleware"
)

func hashRefreshToken(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func newRefreshRaw() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func insertRefreshTokenTx(tx *sql.Tx, userID, raw string) error {
	_, err := tx.Exec(
		`INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)`,
		userID, hashRefreshToken(raw), time.Now().Add(middleware.RefreshTokenTTL()),
	)
	return err
}

func insertRefreshTokenDB(db *sql.DB, userID, raw string) error {
	_, err := db.Exec(
		`INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1,$2,$3)`,
		userID, hashRefreshToken(raw), time.Now().Add(middleware.RefreshTokenTTL()),
	)
	return err
}

func revokeRefreshByRaw(db *sql.DB, raw string) error {
	if raw == "" {
		return nil
	}
	_, err := db.Exec(
		`UPDATE refresh_tokens SET revoked_at=now() WHERE token_hash=$1 AND revoked_at IS NULL`,
		hashRefreshToken(raw),
	)
	return err
}

func revokeAllRefreshForUser(db *sql.DB, userID string) error {
	_, err := db.Exec(
		`UPDATE refresh_tokens SET revoked_at=now() WHERE user_id=$1::uuid AND revoked_at IS NULL`,
		userID,
	)
	return err
}
