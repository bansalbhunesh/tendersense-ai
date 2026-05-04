package middleware

import (
	"os"
	"strings"
	"time"
)

// AccessTokenTTL controls JWT lifetime (default 15m — limits XSS window for bearer access). Examples: 15m, 1h, 24h.
func AccessTokenTTL() time.Duration {
	s := strings.TrimSpace(os.Getenv("JWT_ACCESS_TTL"))
	if s == "" {
		return 15 * time.Minute
	}
	d, err := time.ParseDuration(s)
	if err != nil || d < 5*time.Minute || d > 168*time.Hour {
		return 15 * time.Minute
	}
	return d
}

// RefreshTokenTTL controls refresh cookie/session lifetime (default 720h ≈ 30d).
func RefreshTokenTTL() time.Duration {
	s := strings.TrimSpace(os.Getenv("JWT_REFRESH_TTL"))
	if s == "" {
		return 720 * time.Hour
	}
	d, err := time.ParseDuration(s)
	if err != nil || d < 1*time.Hour || d > 2000*time.Hour {
		return 720 * time.Hour
	}
	return d
}
