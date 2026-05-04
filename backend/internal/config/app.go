package config

import (
	"fmt"
	"log"
	"net/url"
	"os"
	"regexp"
	"strings"
)

// vercelPreviewOrigin matches typical Vercel deployment hosts (production + previews).
// Used only when CORS_ALLOW_VERCEL_PREVIEWS=true (demo / hackathon convenience).
var vercelPreviewOrigin = regexp.MustCompile(`(?i)^https://[a-z0-9][a-z0-9.-]*\.vercel\.app$`)

// App holds validated HTTP and CORS settings from the environment.
type App struct {
	Port                    string
	AllowedOrigins          []string
	originRegexes           []*regexp.Regexp
	allowVercelPreviewHosts bool
	trustForwardedHostCORS  bool
}

// OriginAllowed returns true if the request Origin is listed in ALLOWED_ORIGINS,
// matches any fragment in ALLOWED_ORIGIN_REGEX (see LoadApp), or matches the
// optional Vercel preview rule when CORS_ALLOW_VERCEL_PREVIEWS is enabled.
func (a *App) OriginAllowed(origin string) bool {
	if origin == "" {
		return false
	}
	for _, o := range a.AllowedOrigins {
		if strings.EqualFold(o, origin) {
			return true
		}
	}
	for _, rx := range a.originRegexes {
		if rx.MatchString(origin) {
			return true
		}
	}
	if a.allowVercelPreviewHosts && vercelPreviewOrigin.MatchString(origin) {
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
	var regexes []*regexp.Regexp
	if raw := strings.TrimSpace(os.Getenv("ALLOWED_ORIGIN_REGEX")); raw != "" {
		for _, part := range strings.Split(raw, "|||") {
			part = strings.TrimSpace(part)
			if part == "" {
				continue
			}
			rx, err := regexp.Compile(part)
			if err != nil {
				return nil, fmt.Errorf("ALLOWED_ORIGIN_REGEX fragment %q: %w", part, err)
			}
			regexes = append(regexes, rx)
		}
	}
	allowVercel := resolveAllowVercelPreviewCORS(origins)
	if allowVercel {
		log.Println("config: CORS allows any https://*.vercel.app Origin (preview + production subdomains). Set CORS_ALLOW_VERCEL_PREVIEWS=false to disable.")
	}
	trustFwd := trustForwardedHostCORSEnabled()
	if trustFwd {
		log.Println("config: CORS trusts X-Forwarded-Host / Forwarded when matching Origin (Vercel→API rewrites); set CORS_TRUST_FORWARDED_HOST=false to disable")
	}
	return &App{
		Port:                    port,
		AllowedOrigins:          origins,
		originRegexes:           regexes,
		allowVercelPreviewHosts: allowVercel,
		trustForwardedHostCORS:  trustFwd,
	}, nil
}

// trustForwardedHostCORSEnabled defaults true so preview deployments work behind
// reverse proxies without listing every hostname in ALLOWED_ORIGINS.
// resolveAllowVercelPreviewCORS is true when explicitly enabled, or when
// ALLOWED_ORIGINS already lists a *.vercel.app site (typical Vercel+Render split)
// so preview deployment URLs work without listing each hash in env.
func resolveAllowVercelPreviewCORS(origins []string) bool {
	explicit := strings.TrimSpace(os.Getenv("CORS_ALLOW_VERCEL_PREVIEWS"))
	switch {
	case strings.EqualFold(explicit, "1"), strings.EqualFold(explicit, "true"), strings.EqualFold(explicit, "yes"):
		return true
	case strings.EqualFold(explicit, "0"), strings.EqualFold(explicit, "false"), strings.EqualFold(explicit, "no"), strings.EqualFold(explicit, "off"):
		return false
	default:
		return hasVercelAppOrigin(origins)
	}
}

func hasVercelAppOrigin(origins []string) bool {
	for _, o := range origins {
		u, err := url.Parse(o)
		if err != nil {
			continue
		}
		h := strings.ToLower(u.Hostname())
		if h == "vercel.app" || strings.HasSuffix(h, ".vercel.app") {
			return true
		}
	}
	return false
}

func trustForwardedHostCORSEnabled() bool {
	v := strings.TrimSpace(os.Getenv("CORS_TRUST_FORWARDED_HOST"))
	if v == "" {
		return true
	}
	return !(strings.EqualFold(v, "0") ||
		strings.EqualFold(v, "false") ||
		strings.EqualFold(v, "no") ||
		strings.EqualFold(v, "off"))
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
