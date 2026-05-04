package handlers

import (
	"database/sql"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/gin-gonic/gin"

	"github.com/tendersense/backend/internal/middleware"
)

// TestAuthRequired_missingBearer ensures the authenticated routes return a
// structured 401 envelope when the bearer token is absent.
func TestAuthRequired_missingBearer(t *testing.T) {
	t.Setenv("JWT_SECRET", "test-secret-must-be-32-chars-min!")

	db, _, err := sqlmock.New()
	if err != nil {
		t.Fatal(err)
	}
	defer sqlClose(db)

	gin.SetMode(gin.TestMode)
	r := gin.New()
	api := r.Group("/api/v1")
	api.Use(middleware.AuthRequired(db))
	api.GET("/tenders", ListTenders(db))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/tenders", nil)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401 got %d body=%s", w.Code, w.Body.String())
	}
}

func sqlClose(db *sql.DB) {
	if db != nil {
		_ = db.Close()
	}
}
