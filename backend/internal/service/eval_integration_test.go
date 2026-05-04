//go:build integration

package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"

	"github.com/tendersense/backend/internal/db"
	"github.com/tendersense/backend/internal/repository"
	_ "github.com/lib/pq"
)

// TestIntegration_EvaluatePipeline_MockAI exercises repository → TenderService → HTTP AI → DB transaction.
// Requires: TEST_DATABASE_URL (Postgres).
func TestIntegration_EvaluatePipeline_MockAI(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL to run integration tests")
	}
	t.Setenv("JWT_SECRET", "integration-test-jwt-secret-key-please-change")

	ownerID := uuid.NewString()
	tenderID := uuid.NewString()
	critID := uuid.NewString()
	bidderID := uuid.NewString()
	docID := uuid.NewString()

	pwHash, err := bcrypt.GenerateFromPassword([]byte("password123"), bcrypt.MinCost)
	if err != nil {
		t.Fatal(err)
	}

	critPayload := map[string]any{
		"field": "annual_turnover", "operator": ">=", "value": 1.0, "unit": "INR",
		"text_raw": "Turnover", "mandatory": true,
	}
	critBytes, _ := json.Marshal(critPayload)

	ocr := map[string]any{"text": "Annual turnover Rs. 8 Crore.", "quality_score": 0.95}
	ocrBytes, _ := json.Marshal(ocr)

	database, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })

	if err := db.Migrate(database); err != nil {
		t.Fatal(err)
	}

	ai := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/evaluate" {
			http.NotFound(w, r)
			return
		}
		_ = json.NewEncoder(w).Encode(map[string]any{
			"graph": map[string]any{"nodes": []any{}, "edges": []any{}},
			"decisions": []map[string]any{
				{
					"bidder_id": bidderID, "criterion_id": critID, "verdict": "ELIGIBLE",
					"confidence": 0.9, "reason": "MATCH",
				},
			},
			"review_items": []any{},
		})
	}))
	defer ai.Close()
	t.Setenv("AI_SERVICE_URL", ai.URL)

	ctx := context.Background()
	if _, err := database.ExecContext(ctx, `INSERT INTO users (id, email, password_hash, role) VALUES ($1,$2,$3,'officer')`,
		ownerID, "eval-pipeline-"+ownerID[:8]+"@example.com", string(pwHash)); err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx, `INSERT INTO tenders (id, title, description, owner_id, status) VALUES ($1,'Eval test','', $2,'open')`,
		tenderID, ownerID); err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx, `INSERT INTO criteria (id, tender_id, payload) VALUES ($1,$2,$3::jsonb)`,
		critID, tenderID, string(critBytes)); err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx, `INSERT INTO bidders (id, tender_id, name) VALUES ($1,$2,'BidCo')`,
		bidderID, tenderID); err != nil {
		t.Fatal(err)
	}
	if _, err := database.ExecContext(ctx, `INSERT INTO documents (id, owner_type, owner_id, filename, storage_key, doc_type, ocr_payload) VALUES ($1,'bidder',$2,'abs.pdf','/tmp/ignored.pdf','audited_balance_sheet',$3::jsonb)`,
		docID, bidderID, string(ocrBytes)); err != nil {
		t.Fatal(err)
	}

	repo := repository.NewTenderRepository(database)
	svc := NewTenderService(repo)

	res, err := svc.TriggerEvaluation(ctx, tenderID)
	if err != nil {
		t.Fatalf("TriggerEvaluation: %v", err)
	}
	if res.Decisions != 1 {
		t.Fatalf("expected 1 decision, got %+v", res)
	}

	var n int
	if err := database.QueryRowContext(ctx, `SELECT COUNT(*) FROM decisions WHERE tender_id=$1`, tenderID).Scan(&n); err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Fatalf("expected 1 persisted decision row, got %d", n)
	}
}
