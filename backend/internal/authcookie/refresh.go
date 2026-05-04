package authcookie

import (
	"net/http"
	"os"
	"strings"

	"github.com/gin-gonic/gin"

	"github.com/tendersense/backend/internal/middleware"
)

// Name matches frontend legacy key; value is HttpOnly so JS cannot read it.
const Name = "ts_refresh"

// Path limits the cookie to API routes (works with Vite /api proxy in dev).
const Path = "/api/v1"

func secureFlag(r *http.Request) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("REFRESH_COOKIE_SECURE"))) {
	case "true", "1", "yes":
		return true
	case "false", "0", "no":
		return false
	default:
		if strings.EqualFold(r.Header.Get("X-Forwarded-Proto"), "https") {
			return true
		}
		return r.TLS != nil
	}
}

func sameSiteAttr(r *http.Request) http.SameSite {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("REFRESH_COOKIE_SAMESITE"))) {
	case "strict":
		return http.SameSiteStrictMode
	case "none":
		return http.SameSiteNoneMode
	default:
		return http.SameSiteLaxMode
	}
}

// Set writes the HttpOnly refresh token cookie (rotation on login/register/refresh).
func Set(c *gin.Context, raw string) {
	if raw == "" {
		return
	}
	r := c.Request
	sec := secureFlag(r)
	ss := sameSiteAttr(r)
	if ss == http.SameSiteNoneMode && !sec {
		sec = true
	}
	maxAge := int(middleware.RefreshTokenTTL().Seconds())
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     Name,
		Value:    raw,
		Path:     Path,
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   sec,
		SameSite: ss,
	})
}

// Clear removes the refresh cookie (logout paths).
func Clear(c *gin.Context) {
	r := c.Request
	sec := secureFlag(r)
	ss := sameSiteAttr(r)
	if ss == http.SameSiteNoneMode && !sec {
		sec = true
	}
	http.SetCookie(c.Writer, &http.Cookie{
		Name:     Name,
		Value:    "",
		Path:     Path,
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   sec,
		SameSite: ss,
	})
}

// Read returns the raw refresh token from the cookie, if present.
func Read(c *gin.Context) string {
	v, err := c.Cookie(Name)
	if err != nil || strings.TrimSpace(v) == "" {
		return ""
	}
	return strings.TrimSpace(v)
}
