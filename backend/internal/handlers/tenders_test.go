package handlers

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
)

// newRouter spins up a gin engine that injects a fake user_id (skipping JWT)
// and registers handlers using the supplied *sql.DB.
func newRouter(db *sql.DB, userID string) *gin.Engine {
	return newRouterWithRole(db, userID, "")
}

// newRouterWithRole also sets gin context "role" when role is non-empty (e.g. "admin").
func newRouterWithRole(db *sql.DB, userID, role string) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	api := r.Group("/api/v1")
	api.Use(func(c *gin.Context) {
		if userID != "" {
			c.Set("user_id", userID)
		}
		if role != "" {
			c.Set("role", role)
		}
		c.Next()
	})
	api.POST("/tenders", CreateTender(db))
	api.GET("/tenders", ListTenders(db))
	api.GET("/tenders/:id", GetTender(db))

	api.POST("/tenders/:id/bidders", RegisterBidder(db))
	api.GET("/tenders/:id/bidders", ListBidders(db))
	api.GET("/bidders/:bid", GetBidder(db))

	api.GET("/review/queue", ReviewQueue(db))
	api.POST("/review/override", SubmitOverride(db))
	api.GET("/audit", AuditLog(db))

	api.GET("/tenders/:id/evaluate/jobs/:job", GetEvaluationJobStatus(db))

	return r
}

const (
	testUID = "11111111-1111-1111-1111-111111111111"
	testTID = "22222222-2222-2222-2222-222222222222"
)

func decodeJSON(t *testing.T, body *bytes.Buffer, into any) {
	t.Helper()
	if err := json.Unmarshal(body.Bytes(), into); err != nil {
		t.Fatalf("decode: %v body=%s", err, body.String())
	}
}

func mockOwnerLookup(mock sqlmock.Sqlmock, tenderID, ownerID string) {
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT owner_id::text FROM tenders WHERE id=$1`)).
		WithArgs(tenderID).
		WillReturnRows(sqlmock.NewRows([]string{"owner_id"}).AddRow(ownerID))
}

func TestCreateTender_happy(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO tenders`)).
		WillReturnResult(sqlmock.NewResult(1, 1))
	// audit insert (best-effort, ignored on failure but we still expect it)
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO audit_log`)).
		WillReturnResult(sqlmock.NewResult(1, 1))

	r := newRouter(db, testUID)
	body := strings.NewReader(`{"title":"My Tender","description":"d"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/tenders", body)
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var out map[string]any
	decodeJSON(t, w.Body, &out)
	if out["id"] == "" || out["id"] == nil {
		t.Fatal("expected id in response")
	}
}

func TestCreateTender_badInput(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	r := newRouter(db, testUID)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/tenders", strings.NewReader(`{"title":""}`))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 got %d body=%s", w.Code, w.Body.String())
	}
	var env ErrorEnvelope
	decodeJSON(t, w.Body, &env)
	if env.Error.Code != "bad_request" {
		t.Fatalf("expected bad_request code, got %s", env.Error.Code)
	}
}

// ErrorEnvelope mirrors util.ErrorBody so tests don't have to import util in a cycle-creating way.
type ErrorEnvelope struct {
	Error struct {
		Code      string `json:"code"`
		Message   string `json:"message"`
		RequestID string `json:"request_id"`
	} `json:"error"`
}

func TestListTenders_happyAndPagination(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT COUNT(*) FROM tenders WHERE owner_id=$1`)).
		WithArgs(testUID).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(2))
	rows := sqlmock.NewRows([]string{"id", "title", "status", "created_at"}).
		AddRow("t1", "Tender 1", "open", "2026-01-01").
		AddRow("t2", "Tender 2", "open", "2026-01-02")
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT id, title, status, created_at FROM tenders WHERE owner_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`)).
		WithArgs(testUID, 50, 0).
		WillReturnRows(rows)

	r := newRouter(db, testUID)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/tenders", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	if got := w.Header().Get("X-Total-Count"); got != "2" {
		t.Fatalf("X-Total-Count: %q", got)
	}
	var out struct {
		Tenders []map[string]any `json:"tenders"`
	}
	decodeJSON(t, w.Body, &out)
	if len(out.Tenders) != 2 {
		t.Fatalf("expected 2 tenders, got %d", len(out.Tenders))
	}
}

func TestListTenders_negativeLimit(t *testing.T) {
	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	r := newRouter(db, testUID)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/tenders?limit=-1", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 got %d", w.Code)
	}
}

func TestListTenders_capsLimit(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT COUNT(*) FROM tenders WHERE owner_id=$1`)).
		WithArgs(testUID).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(0))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT id, title, status, created_at FROM tenders WHERE owner_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`)).
		WithArgs(testUID, 200, 0).
		WillReturnRows(sqlmock.NewRows([]string{"id", "title", "status", "created_at"}))

	r := newRouter(db, testUID)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/tenders?limit=9999", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d", w.Code)
	}
	if total, _ := strconv.Atoi(w.Header().Get("X-Total-Count")); total != 0 {
		t.Fatalf("expected total 0 got %d", total)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestGetTender_notFound(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mock.ExpectQuery(regexp.QuoteMeta(`SELECT owner_id::text FROM tenders WHERE id=$1`)).
		WithArgs(testTID).
		WillReturnError(sql.ErrNoRows)

	r := newRouter(db, testUID)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/tenders/"+testTID, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var env ErrorEnvelope
	decodeJSON(t, w.Body, &env)
	if env.Error.Code != "not_found" {
		t.Fatalf("expected not_found code, got %s", env.Error.Code)
	}
}

func TestGetTender_happy(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mockOwnerLookup(mock, testTID, testUID)
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT title, description, status, created_at FROM tenders WHERE id=$1`)).
		WithArgs(testTID).
		WillReturnRows(sqlmock.NewRows([]string{"title", "description", "status", "created_at"}).AddRow("T", "desc", "open", "2026-01-01"))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT id, payload FROM criteria WHERE tender_id=$1`)).
		WithArgs(testTID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "payload"}))

	r := newRouter(db, testUID)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/tenders/"+testTID, nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
}

