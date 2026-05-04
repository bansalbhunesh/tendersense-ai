package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"regexp"
	"sync"
	"testing"
	"time"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"

	"github.com/tendersense/backend/internal/service"
)

// fakeService implements service.TenderService for handler-level tests.
type fakeService struct {
	mu      sync.Mutex
	called  int
	res     *service.EvaluationResult
	err     error
	delay   time.Duration
	doneCh  chan struct{}
}

func (f *fakeService) TriggerEvaluation(_ context.Context, _ string) (*service.EvaluationResult, error) {
	f.mu.Lock()
	f.called++
	f.mu.Unlock()
	if f.delay > 0 {
		time.Sleep(f.delay)
	}
	if f.doneCh != nil {
		defer close(f.doneCh)
	}
	if f.err != nil {
		return nil, f.err
	}
	if f.res == nil {
		return &service.EvaluationResult{ID: "eval-1", Decisions: 1, Graph: map[string]any{}}, nil
	}
	return f.res, nil
}


func TestTriggerEvaluation_forbidden(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT owner_id::text FROM tenders WHERE id=$1`)).
		WithArgs(testTID).
		WillReturnRows(sqlmock.NewRows([]string{"owner_id"}).AddRow("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"))

	r := gin.New()
	gin.SetMode(gin.TestMode)
	r.Use(func(c *gin.Context) { c.Set("user_id", testUID); c.Next() })
	r.POST("/tenders/:id/evaluate", TriggerEvaluation(&fakeService{}, db))

	req := httptest.NewRequest(http.MethodPost, "/tenders/"+testTID+"/evaluate", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403 got %d body=%s", w.Code, w.Body.String())
	}
}

func TestTriggerEvaluation_notFound(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT owner_id::text FROM tenders WHERE id=$1`)).
		WithArgs(testTID).
		WillReturnRows(sqlmock.NewRows([]string{"owner_id"}))

	r := gin.New()
	gin.SetMode(gin.TestMode)
	r.Use(func(c *gin.Context) { c.Set("user_id", testUID); c.Next() })
	r.POST("/tenders/:id/evaluate", TriggerEvaluation(&fakeService{}, db))

	req := httptest.NewRequest(http.MethodPost, "/tenders/"+testTID+"/evaluate", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 got %d", w.Code)
	}
}

func TestTriggerEvaluation_happy(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mockOwnerLookup(mock, testTID, testUID)
	// Insert the queued job
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO evaluation_jobs`)).
		WillReturnResult(sqlmock.NewResult(1, 1))
	// Async update -> running. Use MatchExpectationsInOrder=false so we don't fight the goroutine.
	mock.MatchExpectationsInOrder(false)
	mock.ExpectExec(regexp.QuoteMeta(`UPDATE evaluation_jobs SET status=$1, progress=$2, updated_at=now() WHERE id=$3`)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectExec(regexp.QuoteMeta(`UPDATE evaluation_jobs SET status=$1, progress=$2, payload=$3::jsonb, error=NULL, updated_at=now() WHERE id=$4`)).
		WillReturnResult(sqlmock.NewResult(0, 1))
	// audit insert
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO audit_log`)).
		WillReturnResult(sqlmock.NewResult(1, 1))

	done := make(chan struct{})
	svc := &fakeService{doneCh: done}

	r := gin.New()
	gin.SetMode(gin.TestMode)
	r.Use(func(c *gin.Context) { c.Set("user_id", testUID); c.Next() })
	r.POST("/tenders/:id/evaluate", TriggerEvaluation(svc, db))

	req := httptest.NewRequest(http.MethodPost, "/tenders/"+testTID+"/evaluate", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusAccepted {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var out map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out["status"] != "queued" {
		t.Fatalf("status=%v", out["status"])
	}

	// Wait for the goroutine to finish so sqlmock expectations are recorded
	select {
	case <-done:
	case <-time.After(2 * time.Second):
		t.Fatal("evaluation goroutine did not finish")
	}
	// Give the post-success UPDATE + audit a moment to flush
	time.Sleep(50 * time.Millisecond)
}

func TestTriggerEvaluation_conflictOnDuplicate(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mockOwnerLookup(mock, testTID, testUID)
	// Simulate the partial unique index rejecting a second active job.
	mock.ExpectExec(regexp.QuoteMeta(`INSERT INTO evaluation_jobs`)).
		WillReturnError(errors.New(`pq: duplicate key value violates unique constraint "uq_eval_jobs_active" SQLSTATE 23505`))
	// lookupActiveJob then runs and returns the existing row
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT id, tender_id`)).
		WithArgs(testTID).
		WillReturnRows(sqlmock.NewRows([]string{"id", "tender_id", "user_id", "status", "progress", "error", "payload", "created_at", "updated_at"}).
			AddRow("existing-job", testTID, testUID, "running", 25, "", nil, time.Now(), time.Now()))

	r := gin.New()
	gin.SetMode(gin.TestMode)
	r.Use(func(c *gin.Context) { c.Set("user_id", testUID); c.Next() })
	r.POST("/tenders/:id/evaluate", TriggerEvaluation(&fakeService{}, db))

	req := httptest.NewRequest(http.MethodPost, "/tenders/"+testTID+"/evaluate", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusAccepted {
		t.Fatalf("expected 202 returning existing job, got %d body=%s", w.Code, w.Body.String())
	}
	var out map[string]any
	_ = json.Unmarshal(w.Body.Bytes(), &out)
	if out["job_id"] != "existing-job" {
		t.Fatalf("expected existing job, got %v", out["job_id"])
	}
}

func TestGetEvaluationJobStatus_happy(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	mockOwnerLookup(mock, testTID, testUID)
	now := time.Now()
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT id, tender_id`)).
		WithArgs("job-123").
		WillReturnRows(sqlmock.NewRows([]string{"id", "tender_id", "user_id", "status", "progress", "error", "payload", "created_at", "updated_at"}).
			AddRow("job-123", testTID, testUID, "completed", 100, "", []byte(`{"decisions":1}`), now, now))

	r := newRouter(db, testUID)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/tenders/"+testTID+"/evaluate/jobs/job-123", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	var out evalJobRow
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out.Status != "completed" || out.Progress != 100 {
		t.Fatalf("unexpected job: %+v", out)
	}
	if string(out.Result) != `{"decisions":1}` {
		t.Fatalf("unexpected result: %s", out.Result)
	}
}

func TestGetEvaluationJobStatus_notFound(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mockOwnerLookup(mock, testTID, testUID)
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT id, tender_id`)).
		WithArgs("missing").
		WillReturnError(sql.ErrNoRows)

	r := newRouter(db, testUID)
	req := httptest.NewRequest(http.MethodGet, "/api/v1/tenders/"+testTID+"/evaluate/jobs/missing", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404 got %d body=%s", w.Code, w.Body.String())
	}
	var env ErrorEnvelope
	if err := json.Unmarshal(w.Body.Bytes(), &env); err != nil {
		t.Fatal(err)
	}
	if env.Error.Code != "not_found" {
		t.Fatalf("expected not_found code, got %s", env.Error.Code)
	}
}

func TestGetResults_pagination(t *testing.T) {
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	mockOwnerLookup(mock, testTID, testUID)
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT graph FROM evaluations WHERE tender_id=$1 ORDER BY updated_at DESC LIMIT 1`)).
		WithArgs(testTID).
		WillReturnRows(sqlmock.NewRows([]string{"graph"}).AddRow([]byte(`{}`)))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT COUNT(*) FROM decisions WHERE tender_id=$1`)).
		WithArgs(testTID).
		WillReturnRows(sqlmock.NewRows([]string{"count"}).AddRow(2))
	mock.ExpectQuery(regexp.QuoteMeta(`SELECT payload FROM decisions WHERE tender_id=$1 ORDER BY created_at ASC LIMIT $2 OFFSET $3`)).
		WithArgs(testTID, 1, 0).
		WillReturnRows(sqlmock.NewRows([]string{"payload"}).AddRow([]byte(`{"k":1}`)))

	gin.SetMode(gin.TestMode)
	r := gin.New()
	r.Use(func(c *gin.Context) { c.Set("user_id", testUID); c.Next() })
	r.GET("/tenders/:id/results", GetResults(db))

	req := httptest.NewRequest(http.MethodGet, "/tenders/"+testTID+"/results?limit=1&offset=0", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 got %d body=%s", w.Code, w.Body.String())
	}
	if w.Header().Get("X-Total-Count") != "2" {
		t.Fatalf("X-Total-Count=%q", w.Header().Get("X-Total-Count"))
	}
	var body map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v", err)
	}
	pag, _ := body["pagination"].(map[string]any)
	if pag == nil {
		t.Fatalf("expected pagination, body=%s", w.Body.String())
	}
	total, ok := pag["total"].(float64)
	if !ok || int(total) != 2 {
		t.Fatalf("pagination.total want 2 got %v (%T)", pag["total"], pag["total"])
	}
	dec, _ := body["decisions"].([]any)
	if len(dec) != 1 {
		t.Fatalf("expected 1 decision, got %v", body["decisions"])
	}
}
