package handlers

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

const testBID = "33333333-3333-3333-3333-333333333333"

func TestRegisterBidder_happy(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mockOwnerLookup(mock, testTID, testUID)
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO bidders`)).WillReturnResult(sqlmock.NewResult(1, 1))
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO audit_log`)).WillReturnResult(sqlmock.NewResult(1, 1))

	r := newRouter(db, testUID)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/tenders/"+testTID+"/bidders", strings.NewReader(`{"name":"Acme"}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}

func TestRegisterBidder_badInput(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mockOwnerLookup(mock, testTID, testUID)

	r := newRouter(db, testUID)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/tenders/"+testTID+"/bidders", strings.NewReader(`{"name":""}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 got %d body=%s", w.Code, w.Body.String())
	}
}

func TestRegisterBidder_forbidden(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	// owner is a different user
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT owner_id::text FROM tenders WHERE id=$1`)).
		WithArgs(testTID).
		WillReturnRows(sqlmock.NewRows([]string{"owner_id"}).AddRow("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"))

	r := newRouter(db, testUID)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/tenders/"+testTID+"/bidders", strings.NewReader(`{"name":"x"}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 got %d", w.Code)
	}
	var env ErrorEnvelope
	decodeJSON(t, w.Body, &env)
	if env.Error.Code != "forbidden" {
		t.Fatalf("expected forbidden code, got %s", env.Error.Code)
	}
}

func TestListBidders_paginates(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mockOwnerLookup(mock, testTID, testUID)
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT COUNT(*) FROM bidders WHERE tender_id=$1`)).
		WithArgs(testTID).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(3))
	rows := sqlmock.NewRows([]string{"id", "name", "created_at"}).
		AddRow("b1", "Acme", "2026-01-01").
		AddRow("b2", "Globex", "2026-01-02")
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT id, name, created_at FROM bidders WHERE tender_id=$1 ORDER BY created_at LIMIT $2 OFFSET $3`)).
		WithArgs(testTID, 2, 0).
		WillReturnRows(rows)

	r := newRouter(db, testUID)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/tenders/"+testTID+"/bidders?limit=2", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	if w.Header().Get("X-Total-Count") != "3" {
		t.Fatalf("X-Total-Count=%q", w.Header().Get("X-Total-Count"))
	}
}

func TestListBidders_negativeOffset(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mockOwnerLookup(mock, testTID, testUID)

	r := newRouter(db, testUID)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/tenders/"+testTID+"/bidders?offset=-1", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 got %d body=%s", w.Code, w.Body.String())
	}
}

func TestGetBidder_notFound(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT b.tender_id::text, t.owner_id::text`)).
		WithArgs(testBID).
		WillReturnError(sql.ErrNoRows)

	r := newRouter(db, testUID)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/bidders/"+testBID, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 got %d body=%s", w.Code, w.Body.String())
	}
}

func TestGetBidder_happy(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT b.tender_id::text, t.owner_id::text`)).
		WithArgs(testBID).
		WillReturnRows(sqlmock.NewRows([]string{"tender_id", "owner_id"}).AddRow(testTID, testUID))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT name FROM bidders WHERE id=$1`)).
		WithArgs(testBID).
		WillReturnRows(sqlmock.NewRows([]string{"name"}).AddRow("Acme"))

	r := newRouter(db, testUID)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/bidders/"+testBID, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}
