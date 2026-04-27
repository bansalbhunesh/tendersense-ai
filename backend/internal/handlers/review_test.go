package handlers

import (
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestReviewQueue_paginates(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT COUNT(*)`)).
		WithArgs(testUID).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(1))
	rows := sqlmock.NewRows([]string{"id", "tender_id", "bidder_id", "criterion_id", "payload", "created_at", "title", "name"}).
		AddRow("rq1", testTID, testBID, "c1", []byte(`{"reason":"low confidence"}`), "2026-01-01", "T", "Acme")
	mock.ExpectQuery(`FROM review_queue rq`).
		WithArgs(testUID, 50, 0).
		WillReturnRows(rows)

	r := newRouter(db, testUID)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/review/queue", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	if w.Header().Get("X-Total-Count") != "1" {
		t.Fatalf("X-Total-Count=%q", w.Header().Get("X-Total-Count"))
	}
}

func TestReviewQueue_negativeLimit(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	r := newRouter(db, testUID)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/review/queue?limit=-5", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 got %d", w.Code)
	}
}

func TestSubmitOverride_badInput(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	r := newRouter(db, testUID)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/review/override", strings.NewReader(`{}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 got %d body=%s", w.Code, w.Body.String())
	}
}

func TestSubmitOverride_invalidVerdict(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mockOwnerLookup(mock, testTID, testUID)

	body := `{"tender_id":"` + testTID + `","bidder_id":"` + testBID + `","criterion_id":"c1","new_verdict":"BOGUS","justification":"meets the minimum length requirement"}`
	r := newRouter(db, testUID)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/review/override", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 got %d body=%s", w.Code, w.Body.String())
	}
}
