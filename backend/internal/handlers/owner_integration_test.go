//go:build integration

package handlers

import (
	"bytes"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/tendersense/backend/internal/db"
	"github.com/tendersense/backend/internal/middleware"

	_ "github.com/lib/pq"
)

func integrationRouter(database *sql.DB) *gin.Engine {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	api := r.Group("/api/v1")
	lim := api.Group("")
	lim.Use(middleware.AuthRouteLimiter(1000, 1000))
	lim.POST("/auth/register", Register(database))
	lim.POST("/auth/login", Login(database))
	auth := api.Group("")
	auth.Use(middleware.AuthRequired())
	auth.POST("/tenders", CreateTender(database))
	auth.GET("/tenders/:id", GetTender(database))
	return r
}

func authRegister(t *testing.T, r *gin.Engine, email, password string) string {
	t.Helper()
	body := fmt.Sprintf(`{"email":%q,"password":%q}`, email, password)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/auth/register", bytes.NewReader([]byte(body)))
	req.Header.Set("Content-Type", "application/json")
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("register: status=%d body=%s", w.Code, w.Body.String())
	}
	var out struct {
		Token       string `json:"token"`
		AccessToken string `json:"access_token"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	if out.AccessToken != "" {
		return out.AccessToken
	}
	return out.Token
}

func createTender(t *testing.T, r *gin.Engine, token string) string {
	t.Helper()
	body := `{"title":"Integration isolation tender","description":"test"}`
	req := httptest.NewRequest(http.MethodPost, "/api/v1/tenders", bytes.NewReader([]byte(body)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusCreated {
		t.Fatalf("create tender: status=%d body=%s", w.Code, w.Body.String())
	}
	var out struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return out.ID
}

func getTender(t *testing.T, r *gin.Engine, token, tenderID string) int {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/tenders/"+tenderID, nil)
	req.Header.Set("Authorization", "Bearer "+token)
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w.Code
}

func TestIntegration_GetTender_crossTenantForbidden(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("set TEST_DATABASE_URL to a Postgres DSN to run integration tests")
	}
	t.Setenv("JWT_SECRET", "integration-test-jwt-secret-key-please-change")

	database, err := sql.Open("postgres", dsn)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = database.Close() })

	if err := db.Migrate(database); err != nil {
		t.Fatal(err)
	}

	r := integrationRouter(database)
	suffix := uuid.NewString()
	emailA := fmt.Sprintf("owner_a_%s@example.com", suffix)
	emailB := fmt.Sprintf("owner_b_%s@example.com", suffix)
	pw := "longpassword123"

	tokenA := authRegister(t, r, emailA, pw)
	tokenB := authRegister(t, r, emailB, pw)
	tenderID := createTender(t, r, tokenA)

	if code := getTender(t, r, tokenB, tenderID); code != http.StatusForbidden {
		t.Fatalf("other user get tender: want 403 got %d", code)
	}
	if code := getTender(t, r, tokenA, tenderID); code != http.StatusOK {
		t.Fatalf("owner get tender: want 200 got %d", code)
	}
}
