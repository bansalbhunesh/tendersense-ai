package handlers

import (
	"net/http"
	"net/http/httptest"
	"regexp"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
)

func TestAuditLog_paginates(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT COUNT(*) FROM audit_log WHERE (`)).
		WithArgs(testUID).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(7))
	rows := sqlmock.NewRows([]string{"id", "tender_id", "user_id", "action", "payload", "checksum", "created_at"}).
		AddRow(int64(1), testTID, testUID, "tender.created", []byte(`{}`), "sha256:abc", "2026-01-01")
	mock.ExpectQuery(`FROM audit_log WHERE \(`).
		WithArgs(testUID, 50, 0).
		WillReturnRows(rows)

	r := newRouter(db, testUID)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/audit", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	if w.Header().Get("X-Total-Count") != "7" {
		t.Fatalf("X-Total-Count=%q", w.Header().Get("X-Total-Count"))
	}
}

func TestAuditLog_byTender_notFound(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	// owner lookup fails with sql.ErrNoRows -> 404
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT owner_id::text FROM tenders WHERE id=$1`)).
		WithArgs(testTID).
		WillReturnRows(sqlmock.NewRows([]string{"owner_id"})) // no rows
	r := newRouter(db, testUID)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/audit?tender_id="+testTID, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 got %d body=%s", w.Code, w.Body.String())
	}
}

func TestAuditLog_negativeOffset(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	r := newRouter(db, testUID)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/audit?offset=-1", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 got %d", w.Code)
	}
}
