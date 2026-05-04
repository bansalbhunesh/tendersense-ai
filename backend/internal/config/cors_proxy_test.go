package config

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestForwardedHostMatchesOrigin(t *testing.T) {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "https://api.example.com/api/v1/auth/register", nil)
	c.Request.Header.Set("Origin", "https://tendersense-abc-bansalbhuneshs-projects.vercel.app")
	c.Request.Header.Set("X-Forwarded-Host", "tendersense-abc-bansalbhuneshs-projects.vercel.app")

	if !forwardedHostMatchesOrigin(c, "https://tendersense-abc-bansalbhuneshs-projects.vercel.app") {
		t.Fatal("expected X-Forwarded-Host match")
	}
}

func TestAllowOriginViaForwardedHost_disabled(t *testing.T) {
	gin.SetMode(gin.TestMode)
	a := &App{trustForwardedHostCORS: false}
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/", nil)
	c.Request.Header.Set("Origin", "https://a.vercel.app")
	c.Request.Header.Set("X-Forwarded-Host", "a.vercel.app")
	if a.AllowOriginViaForwardedHost(c, "https://a.vercel.app") {
		t.Fatal("should not match when trust disabled")
	}
}

func TestLoadApp_impliedVercelCORS(t *testing.T) {
	t.Setenv("ALLOWED_ORIGINS", "http://localhost:5173,https://tendersense-ai.vercel.app")
	t.Setenv("CORS_ALLOW_VERCEL_PREVIEWS", "")
	t.Setenv("CORS_TRUST_FORWARDED_HOST", "false")
	a, err := LoadApp()
	if err != nil {
		t.Fatal(err)
	}
	if !a.OriginAllowed("https://tendersense-7qme2m8z8-bansalbhuneshs-projects.vercel.app") {
		t.Fatal("expected implied *.vercel.app CORS for preview URL")
	}
}

func TestLoadApp_explicitDisableVercelCORS(t *testing.T) {
	t.Setenv("ALLOWED_ORIGINS", "https://tendersense-ai.vercel.app")
	t.Setenv("CORS_ALLOW_VERCEL_PREVIEWS", "false")
	t.Setenv("CORS_TRUST_FORWARDED_HOST", "false")
	a, err := LoadApp()
	if err != nil {
		t.Fatal(err)
	}
	if a.OriginAllowed("https://other-random.vercel.app") {
		t.Fatal("should not allow wildcard vercel when explicitly disabled")
	}
}
