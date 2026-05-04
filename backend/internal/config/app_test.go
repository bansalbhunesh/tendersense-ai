package config

import (
	"regexp"
	"testing"
)

func TestOriginAllowed_exactAndRegex(t *testing.T) {
	a := &App{
		AllowedOrigins: []string{"http://localhost:5173", "HTTPS://EXAMPLE.COM"},
		originRegexes:  []*regexp.Regexp{mustRx(t, `^https://tendersense-[a-z0-9]+-team\.vercel\.app$`)},
	}
	if !a.OriginAllowed("http://localhost:5173") {
		t.Fatal("localhost should match")
	}
	if !a.OriginAllowed("https://example.com") {
		t.Fatal("case-insensitive exact match")
	}
	if !a.OriginAllowed("https://tendersense-abc12-team.vercel.app") {
		t.Fatal("regex match")
	}
	if a.OriginAllowed("https://evil.example.com") {
		t.Fatal("should not match")
	}
}

func TestOriginAllowed_vercelBypass(t *testing.T) {
	a := &App{
		AllowedOrigins:          []string{"http://localhost:5173"},
		allowVercelPreviewHosts: true,
	}
	if !a.OriginAllowed("https://tendersense-pt6cdsvqk-bansalbhuneshs-projects.vercel.app") {
		t.Fatal("vercel preview should match when bypass enabled")
	}
	if a.OriginAllowed("https://notvercel.example.com") {
		t.Fatal("non-vercel should not match")
	}
	if a.OriginAllowed("http://insecure.vercel.app") {
		t.Fatal("http vercel should not match")
	}
}

func mustRx(t *testing.T, s string) *regexp.Regexp {
	t.Helper()
	rx, err := regexp.Compile(s)
	if err != nil {
		t.Fatal(err)
	}
	return rx
}
