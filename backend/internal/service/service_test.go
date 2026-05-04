package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/tendersense/backend/internal/repository"
)

type mockRepo struct {
	repository.TenderRepository
	getCriteriaFn        func() ([]map[string]any, error)
	getBidderIDsFn       func() ([]string, error)
	getBidderDocumentsFn func(string) ([]map[string]any, error)
	withTransactionFn    func(context.Context, func(*sql.Tx) error) error
	clearTenderResultsFn func(string) error
	saveDecisionFn       func(map[string]any, string) error
	saveEvaluationFn     func(string, string, string, string) error
	saveReviewItemFn     func(string, string, map[string]any) error
}

func (m *mockRepo) GetCriteria(ctx context.Context, id string) ([]map[string]any, error) {
	return m.getCriteriaFn()
}

func (m *mockRepo) GetBidderIDs(ctx context.Context, tenderID string) ([]string, error) {
	return m.getBidderIDsFn()
}

func (m *mockRepo) GetBidderDocuments(ctx context.Context, bidderID string) ([]map[string]any, error) {
	return m.getBidderDocumentsFn(bidderID)
}

func (m *mockRepo) WithTransaction(ctx context.Context, fn func(*sql.Tx) error) error {
	return m.withTransactionFn(ctx, fn)
}

func (m *mockRepo) ClearTenderResults(ctx context.Context, tx *sql.Tx, tenderID string) error {
	return m.clearTenderResultsFn(tenderID)
}

func (m *mockRepo) SaveDecision(ctx context.Context, tx *sql.Tx, d map[string]any, tenderID, checksum string) error {
	return m.saveDecisionFn(d, checksum)
}

func (m *mockRepo) SaveEvaluation(ctx context.Context, tx *sql.Tx, id, tenderID, status, graph string) error {
	return m.saveEvaluationFn(id, tenderID, status, graph)
}

func (m *mockRepo) SaveReviewItem(ctx context.Context, tx *sql.Tx, id, tenderID string, payload map[string]any) error {
	return m.saveReviewItemFn(id, tenderID, payload)
}

func newHappyPathMockRepo() *mockRepo {
	return &mockRepo{
		getCriteriaFn: func() ([]map[string]any, error) {
			return []map[string]any{{"id": 42, "field": "net_worth"}}, nil
		},
		getBidderIDsFn: func() ([]string, error) {
			return []string{uuid.NewString()}, nil
		},
		getBidderDocumentsFn: func(_ string) ([]map[string]any, error) {
			return []map[string]any{{"id": "doc1", "ocr": map[string]any{"text": "example"}}}, nil
		},
		withTransactionFn: func(_ context.Context, fn func(*sql.Tx) error) error {
			return fn(nil)
		},
		clearTenderResultsFn: func(_ string) error { return nil },
		saveDecisionFn:       func(_ map[string]any, _ string) error { return nil },
		saveEvaluationFn:     func(_, _, _, _ string) error { return nil },
		saveReviewItemFn:     func(_, _ string, _ map[string]any) error { return nil },
	}
}

func TestTriggerEvaluation_NoCriteria(t *testing.T) {
	repo := newHappyPathMockRepo()
	repo.getCriteriaFn = func() ([]map[string]any, error) { return []map[string]any{}, nil }
	svc := NewTenderService(repo)

	_, err := svc.TriggerEvaluation(context.Background(), "test-tender")
	if err == nil {
		t.Fatal("expected error when no criteria found, got nil")
	}
	if err.Error() != "no criteria found for tender" {
		t.Fatalf("expected specific error message, got: %v", err)
	}
}

func TestTriggerEvaluation_NoBidders(t *testing.T) {
	repo := newHappyPathMockRepo()
	repo.getBidderIDsFn = func() ([]string, error) { return []string{}, nil }
	svc := NewTenderService(repo)

	_, err := svc.TriggerEvaluation(context.Background(), "test-tender")
	if err == nil {
		t.Fatal("expected error when no bidders are registered")
	}
	if err.Error() != "no bidders registered" {
		t.Fatalf("unexpected error: %v", err)
	}
}

func TestTriggerEvaluation_FiltersInvalidAIRowsAndSavesValidOnes(t *testing.T) {
	var (
		savedDecisions   []map[string]any
		savedReviewItems []map[string]any
		savedGraph       map[string]any
	)
	repo := newHappyPathMockRepo()
	repo.saveDecisionFn = func(d map[string]any, _ string) error {
		c := map[string]any{}
		for k, v := range d {
			c[k] = v
		}
		savedDecisions = append(savedDecisions, c)
		return nil
	}
	repo.saveEvaluationFn = func(_, _, _, graph string) error {
		_ = json.Unmarshal([]byte(graph), &savedGraph)
		return nil
	}
	repo.saveReviewItemFn = func(_, _ string, payload map[string]any) error {
		c := map[string]any{}
		for k, v := range payload {
			c[k] = v
		}
		savedReviewItems = append(savedReviewItems, c)
		return nil
	}

	validBid := uuid.NewString()
	aiServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/evaluate" {
			t.Fatalf("unexpected path: %s", r.URL.Path)
		}
		var req map[string]any
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if s, ok := req["cache_bust"].(string); !ok || s == "" {
			t.Fatalf("expected non-empty cache_bust for evaluate cache isolation, got %#v", req["cache_bust"])
		}
		criteria, _ := req["criteria"].([]any)
		if len(criteria) != 1 {
			t.Fatalf("expected one criterion, got %d", len(criteria))
		}
		c0, _ := criteria[0].(map[string]any)
		if _, ok := c0["id"].(string); !ok {
			t.Fatalf("criterion id should be stringified before AI call")
		}

		_ = json.NewEncoder(w).Encode(map[string]any{
			"graph": map[string]any{"nodes": []any{}, "edges": []any{}},
			"decisions": []map[string]any{
				{"bidder_id": "not-a-uuid", "criterion_id": "c1", "verdict": "ELIGIBLE"},
				{"bidder_id": validBid, "criterion_id": "", "verdict": "ELIGIBLE"},
				{"bidder_id": validBid, "criterion_id": "c1", "verdict": "ELIGIBLE"},
			},
			"review_items": []map[string]any{
				{"bidder_id": "bad", "criterion_id": "c1"},
				{"bidder_id": validBid, "criterion_id": "c1", "reason": "low confidence"},
			},
		})
	}))
	defer aiServer.Close()
	t.Setenv("AI_SERVICE_URL", aiServer.URL)

	svc := NewTenderService(repo)
	res, err := svc.TriggerEvaluation(context.Background(), "test-tender")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res.Decisions != 1 {
		t.Fatalf("expected one valid decision, got %+v", res)
	}
	if len(savedDecisions) != 1 {
		t.Fatalf("expected 1 saved decision, got %d", len(savedDecisions))
	}
	if len(savedReviewItems) != 1 {
		t.Fatalf("expected 1 saved review item, got %d", len(savedReviewItems))
	}
	if savedGraph == nil {
		t.Fatal("expected evaluation graph to be saved")
	}
}

func TestTriggerEvaluation_TransactionFailureIsWrapped(t *testing.T) {
	repo := newHappyPathMockRepo()
	repo.withTransactionFn = func(_ context.Context, _ func(*sql.Tx) error) error {
		return context.DeadlineExceeded
	}
	aiServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]any{
			"graph": map[string]any{},
			"decisions": []map[string]any{
				{"bidder_id": uuid.NewString(), "criterion_id": "c1", "verdict": "ELIGIBLE"},
			},
			"review_items": []map[string]any{},
		})
	}))
	defer aiServer.Close()
	t.Setenv("AI_SERVICE_URL", aiServer.URL)

	svc := NewTenderService(repo)
	_, err := svc.TriggerEvaluation(context.Background(), "test-tender")
	if err == nil {
		t.Fatal("expected wrapped transaction error")
	}
	if !strings.Contains(err.Error(), "db transaction") {
		t.Fatalf("expected db transaction wrapper, got: %v", err)
	}
}

func TestTriggerEvaluation_BidderDocumentsFailureIsPropagated(t *testing.T) {
	bidderID := uuid.NewString()
	repo := newHappyPathMockRepo()
	repo.getBidderIDsFn = func() ([]string, error) { return []string{bidderID}, nil }
	repo.getBidderDocumentsFn = func(id string) ([]map[string]any, error) {
		if id != bidderID {
			t.Fatalf("unexpected bidder id: %s", id)
		}
		return nil, context.DeadlineExceeded
	}

	svc := NewTenderService(repo)
	_, err := svc.TriggerEvaluation(context.Background(), "test-tender")
	if err == nil {
		t.Fatal("expected bidder document fetch error")
	}
	if !strings.Contains(err.Error(), "fetch bidder documents") {
		t.Fatalf("expected bidder document context in error, got: %v", err)
	}
	if !strings.Contains(err.Error(), bidderID) {
		t.Fatalf("expected bidder id in error, got: %v", err)
	}
}
