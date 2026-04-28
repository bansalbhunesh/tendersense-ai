package config

import (
	"fmt"
	"log"
	"os"
	"regexp"
	"strings"
)

// App holds validated HTTP and CORS settings from the environment.
type App struct {
	Port           string
	AllowedOrigins []string
	originRegex    *regexp.Regexp
}

// OriginAllowed returns true if the request Origin is listed in ALLOWED_ORIGINS
// or matches ALLOWED_ORIGIN_REGEX (e.g. Vercel preview URLs).
func (a *App) OriginAllowed(origin string) bool {
	if origin == "" {
		return false
	}
	for _, o := range a.AllowedOrigins {
		if o == origin {
			return true
		}
	}
	if a.originRegex != nil && a.originRegex.MatchString(origin) {
		return true
	}
	return false
}

// LoadApp loads CORS-related configuration. ALLOWED_ORIGINS must list at least one origin.
func LoadApp() (*App, error) {
	port := strings.TrimSpace(os.Getenv("PORT"))
	if port == "" {
		port = "8080"
	}
	var origins []string
	for _, o := range strings.Split(os.Getenv("ALLOWED_ORIGINS"), ",") {
		if s := strings.TrimSpace(o); s != "" {
			origins = append(origins, s)
		}
	}
	if len(origins) == 0 {
		return nil, fmt.Errorf("ALLOWED_ORIGINS must contain at least one non-empty origin (comma-separated)")
	}
	var rx *regexp.Regexp
	if raw := strings.TrimSpace(os.Getenv("ALLOWED_ORIGIN_REGEX")); raw != "" {
		var err error
		rx, err = regexp.Compile(raw)
		if err != nil {
			return nil, fmt.Errorf("ALLOWED_ORIGIN_REGEX: %w", err)
		}
	}
	return &App{Port: port, AllowedOrigins: origins, originRegex: rx}, nil
}

// ValidateCoreSecrets ensures required secrets and URLs are present before opening the database.
func ValidateCoreSecrets() {
	required := []string{"JWT_SECRET", "DATABASE_URL"}
	var missing []string
	for _, key := range required {
		if strings.TrimSpace(os.Getenv(key)) == "" {
			missing = append(missing, key)
		}
	}
	if len(missing) > 0 {
		log.Fatalf("missing required environment variables: %v", missing)
	}
	if secret := os.Getenv("JWT_SECRET"); len(strings.TrimSpace(secret)) < 32 {
		log.Printf("warning: JWT_SECRET is shorter than 32 chars (len=%d); use a longer random value in production", len(secret))
	}
}
