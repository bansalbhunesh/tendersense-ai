package handlers

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"
)

func TestNormalizeBidderDocType(t *testing.T) {
	t.Parallel()
	if s, ok := NormalizeBidderDocType(""); !ok || s != "supporting" {
		t.Fatalf("empty: got %q ok=%v", s, ok)
	}
	if s, ok := NormalizeBidderDocType("  GST_Certificate "); !ok || s != "gst_certificate" {
		t.Fatalf("gst: got %q ok=%v", s, ok)
	}
	if _, ok := NormalizeBidderDocType("../../../etc/passwd"); ok {
		t.Fatal("expected reject junk doc_type")
	}
}

func TestRequireTenderOwner_allowed(t *testing.T) {
	t.Parallel()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	tid := "11111111-1111-1111-1111-111111111111"
	uid := "22222222-2222-2222-2222-222222222222"
	mock.ExpectQuery("SELECT owner_id::text FROM tenders WHERE id").
		WithArgs(tid).
		WillReturnRows(sqlmock.NewRows([]string{"owner_id"}).AddRow(uid))

	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("user_id", uid)

	if !RequireTenderOwner(db, c, tid) {
		t.Fatal("expected owner allowed")
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestRequireTenderOwner_forbidden(t *testing.T) {
	t.Parallel()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	tid := "11111111-1111-1111-1111-111111111111"
	mock.ExpectQuery("SELECT owner_id::text FROM tenders WHERE id").
		WithArgs(tid).
		WillReturnRows(sqlmock.NewRows([]string{"owner_id"}).AddRow("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"))

	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("user_id", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")

	if RequireTenderOwner(db, c, tid) {
		t.Fatal("expected forbidden")
	}
	if w.Code != http.StatusForbidden {
		t.Fatalf("code=%d body=%s", w.Code, w.Body.String())
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}

func TestRequireTenderOwner_notFound(t *testing.T) {
	t.Parallel()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	tid := "11111111-1111-1111-1111-111111111111"
	mock.ExpectQuery("SELECT owner_id::text FROM tenders WHERE id").
		WithArgs(tid).
		WillReturnError(sql.ErrNoRows)

	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("user_id", "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")

	if RequireTenderOwner(db, c, tid) {
		t.Fatal("expected not found")
	}
	if w.Code != http.StatusNotFound {
		t.Fatalf("code=%d", w.Code)
	}
}

func TestRequireBidderForOwner_allowed(t *testing.T) {
	t.Parallel()
	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	bid := "33333333-3333-3333-3333-333333333333"
	tid := "11111111-1111-1111-1111-111111111111"
	uid := "22222222-2222-2222-2222-222222222222"
	mock.ExpectQuery("SELECT b.tender_id::text, t.owner_id::text").
		WithArgs(bid).
		WillReturnRows(sqlmock.NewRows([]string{"tender_id", "owner_id"}).AddRow(tid, uid))

	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Set("user_id", uid)

	gotTid, ok := RequireBidderForOwner(db, c, bid)
	if !ok || gotTid != tid {
		t.Fatalf("ok=%v tenderID=%q", ok, gotTid)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatal(err)
	}
}
