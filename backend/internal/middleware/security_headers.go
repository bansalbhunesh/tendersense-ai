package middleware

import (
	"os"
	"strings"

	"github.com/gin-gonic/gin"
)

// SecurityHeaders sets baseline hardening headers for API responses.
func SecurityHeaders() gin.HandlerFunc {
	trustProxy := strings.EqualFold(strings.TrimSpace(os.Getenv("TRUST_PROXY_TLS")), "true")
	return func(c *gin.Context) {
		c.Header("X-Content-Type-Options", "nosniff")
		c.Header("X-Frame-Options", "DENY")
		c.Header("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Header("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		// JSON API only — no inline scripts or frames served from this service.
		c.Header("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
		if trustProxy && c.Request.TLS != nil {
			c.Header("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}
		c.Next()
	}
}
