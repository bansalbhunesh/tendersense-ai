package db

import (
	"database/sql"
	"fmt"
	"os"
	"time"

	_ "github.com/lib/pq"
)

func Connect() (*sql.DB, error) {
	dsn := os.Getenv("DATABASE_URL")
	if dsn == "" {
		return nil, fmt.Errorf("DATABASE_URL is required")
	}
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, err
	}

	// Connection pool tuning for production
	db.SetMaxOpenConns(25)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(5 * time.Minute)
	db.SetConnMaxIdleTime(2 * time.Minute)

	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("ping: %w", err)
	}
	return db, nil
}

func Migrate(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	stmts := []string{
		`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`,
		`CREATE TABLE IF NOT EXISTS users (
			id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
			email TEXT UNIQUE NOT NULL,
			password_hash TEXT NOT NULL,
			role TEXT NOT NULL DEFAULT 'officer',
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		);`,
		`CREATE TABLE IF NOT EXISTS password_reset_tokens (
			id BIGSERIAL PRIMARY KEY,
			email TEXT NOT NULL,
			token TEXT NOT NULL,
			used BOOLEAN NOT NULL DEFAULT false,
			expires_at TIMESTAMPTZ NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		);`,
		`CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_email ON password_reset_tokens(email);`,
		`CREATE TABLE IF NOT EXISTS tenders (
			id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
			title TEXT NOT NULL,
			description TEXT,
			owner_id UUID REFERENCES users(id),
			status TEXT NOT NULL DEFAULT 'draft',
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		);`,
		`CREATE INDEX IF NOT EXISTS idx_tenders_owner_id ON tenders(owner_id);`,
		`CREATE INDEX IF NOT EXISTS idx_tenders_status ON tenders(status);`,

		`CREATE TABLE IF NOT EXISTS criteria (
			id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
			tender_id UUID NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
			payload JSONB NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		);`,
		`CREATE INDEX IF NOT EXISTS idx_criteria_tender_id ON criteria(tender_id);`,

		`CREATE TABLE IF NOT EXISTS bidders (
			id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
			tender_id UUID NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
			name TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		);`,
		`CREATE INDEX IF NOT EXISTS idx_bidders_tender_id ON bidders(tender_id);`,

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
		`CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents(owner_type, owner_id);`,

		`CREATE TABLE IF NOT EXISTS evaluations (
			id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
			tender_id UUID NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
			status TEXT NOT NULL DEFAULT 'pending',
			graph JSONB,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
		);`,
		`CREATE INDEX IF NOT EXISTS idx_evals_tender_id ON evaluations(tender_id);`,

		`CREATE TABLE IF NOT EXISTS decisions (
			id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
			tender_id UUID NOT NULL REFERENCES tenders(id) ON DELETE CASCADE,
			bidder_id UUID NOT NULL REFERENCES bidders(id) ON DELETE CASCADE,
			criterion_id TEXT NOT NULL,
			payload JSONB NOT NULL,
			checksum TEXT NOT NULL,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now()
		);`,
		`CREATE INDEX IF NOT EXISTS idx_decisions_tender_bidder ON decisions(tender_id, bidder_id);`,

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
		`CREATE INDEX IF NOT EXISTS idx_rq_tender_id ON review_queue(tender_id);`,

		// Evaluation jobs: persisted state for the async eval pipeline.
		// `payload` carries the serialized result on completion.
		`CREATE TABLE IF NOT EXISTS evaluation_jobs (
			id TEXT PRIMARY KEY,
			tender_id TEXT NOT NULL,
			user_id TEXT,
			status TEXT NOT NULL DEFAULT 'queued',
			progress INT NOT NULL DEFAULT 0,
			error TEXT,
			payload JSONB,
			created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
			updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
		);`,
		`CREATE INDEX IF NOT EXISTS idx_eval_jobs_tender ON evaluation_jobs(tender_id);`,
		// Replaces the in-memory per-tender lock: at most one queued/running job per tender.
		`CREATE UNIQUE INDEX IF NOT EXISTS uq_eval_jobs_active
			ON evaluation_jobs(tender_id)
			WHERE status IN ('queued','running');`,
	}
	for _, s := range stmts {
		if _, err := tx.Exec(s); err != nil {
			return fmt.Errorf("migrate: %w\nstmt: %s", err, s)
		}
	}
	return tx.Commit()
}

// RecoverInterruptedJobs marks any leftover queued/running evaluation jobs as
// "interrupted" with an explanatory error. Call once at boot before serving.
func RecoverInterruptedJobs(db *sql.DB) error {
	if db == nil {
		return nil
	}
	_, err := db.Exec(`
		UPDATE evaluation_jobs
		   SET status='interrupted',
		       error=COALESCE(NULLIF(error,''),'process restart'),
		       updated_at=now()
		 WHERE status IN ('queued','running')`)
	return err
}
