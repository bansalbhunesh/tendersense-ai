package util

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/gin-gonic/gin"
)

func newCtx(rawQuery string) (*gin.Context, *httptest.ResponseRecorder) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	u := &url.URL{RawQuery: rawQuery}
	c.Request = &http.Request{URL: u}
	return c, w
}

func TestParsePagination_defaults(t *testing.T) {
	c, _ := newCtx("")
	p, err := ParsePagination(c)
	if err != nil {
		t.Fatal(err)
	}
	if p.Limit != DefaultPaginationLimit || p.Offset != 0 {
		t.Fatalf("got %+v", p)
	}
}

func TestParsePagination_caps(t *testing.T) {
	c, _ := newCtx("limit=9999&offset=10")
	p, err := ParsePagination(c)
	if err != nil {
		t.Fatal(err)
	}
	if p.Limit != MaxPaginationLimit {
		t.Fatalf("want capped at %d got %d", MaxPaginationLimit, p.Limit)
	}
	if p.Offset != 10 {
		t.Fatalf("offset=%d", p.Offset)
	}
}

func TestParsePagination_negativeRejected(t *testing.T) {
	c, _ := newCtx("limit=-1")
	if _, err := ParsePagination(c); err == nil {
		t.Fatal("expected error")
	}
	c, _ = newCtx("offset=-3")
	if _, err := ParsePagination(c); err == nil {
		t.Fatal("expected error")
	}
}

func TestParsePagination_badNumber(t *testing.T) {
	c, _ := newCtx("limit=abc")
	if _, err := ParsePagination(c); err == nil {
		t.Fatal("expected error")
	}
}

func TestWriteError_includesRequestID(t *testing.T) {
	c, w := newCtx("")
	c.Set("request_id", "req-xyz")
	WriteError(c, http.StatusForbidden, CodeForbidden, "no")
	if w.Code != http.StatusForbidden {
		t.Fatalf("status=%d", w.Code)
	}
	var body ErrorBody
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Error.Code != CodeForbidden || body.Error.RequestID != "req-xyz" {
		t.Fatalf("got %+v", body)
	}
}

func TestWriteError_generatesRequestIDWhenMissing(t *testing.T) {
	c, w := newCtx("")
	BadRequest(c, "bad")
	if w.Code != http.StatusBadRequest {
		t.Fatalf("status=%d", w.Code)
	}
	var body ErrorBody
	if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Error.RequestID == "" {
		t.Fatal("expected generated request id")
	}
	if body.Error.Code != CodeBadRequest {
		t.Fatalf("got code %s", body.Error.Code)
	}
}
