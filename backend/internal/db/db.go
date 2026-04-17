package db

import (
	"database/sql"
	"fmt"
	"os"

	_ "github.com/lib/pq"
)

func Connect() (*sql.DB, error) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://tendersense:tendersense@localhost:5432/tendersense?sslmode=disable"
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, err
	}
	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("ping: %w", err)
	}
	return db, nil
}

func Migrate(db *sql.DB) error {
	stmts := []string{
		`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`,
		`CREATE TABLE IF NOT EXISTS users (
			id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
			email TEXT UNIQUE NOT NULL,
			password_hash TEXT NOT NULL,
			role TEXT NOT NULL DEFAULT 'officer',
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		);`,
		`CREATE TABLE IF NOT EXISTS tenders (
			id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
			title TEXT NOT NULL,
			description TEXT,
			owner_id UUID REFERENCES users(id),
			status TEXT NOT NULL DEFAULT 'draft',
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		);`,
		`CREATE TABLE IF NOT EXISTS criteria (
			id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
			tender_id UUID NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
			payload JSONB NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		);`,
		`CREATE TABLE IF NOT EXISTS bidders (
			id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
			tender_id UUID NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
			name TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		);`,
		`CREATE TABLE IF NOT EXISTS documents (
			id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
			owner_type TEXT NOT NULL,
			owner_id UUID NOT NULL,
			filename TEXT NOT NULL,
			storage_key TEXT NOT NULL,
			doc_type TEXT,
			quality_score DOUBLE PRECISION DEFAULT 0,
			ocr_payload JSONB,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		);`,
		`CREATE TABLE IF NOT EXISTS evaluations (
			id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
			tender_id UUID NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
			status TEXT NOT NULL DEFAULT 'pending',
			graph JSONB,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
		);`,
		`CREATE TABLE IF NOT EXISTS decisions (
			id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
			tender_id UUID NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
			bidder_id UUID NOT NULL REFERENCES bidders(id) ON DELETE CASCADE,
			criterion_id TEXT NOT NULL,
			payload JSONB NOT NULL,
			checksum TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		);`,
		`CREATE TABLE IF NOT EXISTS audit_log (
			id BIGSERIAL PRIMARY KEY,
			tender_id UUID,
			user_id UUID,
			action TEXT NOT NULL,
			payload JSONB,
			checksum TEXT,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		);`,
		`CREATE TABLE IF NOT EXISTS review_queue (
			id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
			tender_id UUID NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
			bidder_id UUID NOT NULL REFERENCES bidders(id) ON DELETE CASCADE,
			criterion_id TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'open',
			payload JSONB,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		);`,
	}
	for _, s := range stmts {
		if _, err := db.Exec(s); err != nil {
			return fmt.Errorf("migrate: %w\nstmt: %s", err, s)
		}
	}
	return nil
}
