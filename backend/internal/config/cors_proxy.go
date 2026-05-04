package config

import (
	"net/url"
	"strings"

	"github.com/gin-gonic/gin"
)

// AllowOriginViaForwardedHost is the gin-contrib/cors AllowOriginWithContextFunc
// fallback when OriginAllowed returns false. It allows the browser Origin when it
// matches X-Forwarded-Host or Forwarded (host=) — typical for Vercel rewrites to an
// upstream API (browser Origin is the Vercel hostname; API Host is Render).
func (a *App) AllowOriginViaForwardedHost(c *gin.Context, origin string) bool {
	if !a.trustForwardedHostCORS {
		return false
	}
	return forwardedHostMatchesOrigin(c, origin)
}

func forwardedHostMatchesOrigin(c *gin.Context, origin string) bool {
	if origin == "" || c == nil || c.Request == nil {
		return false
	}
	u, err := url.Parse(origin)
	if err != nil || u.Hostname() == "" {
		return false
	}
	origHost := strings.ToLower(u.Hostname())
	origScheme := strings.ToLower(u.Scheme)
	if origScheme != "https" && origScheme != "http" {
		return false
	}
	origPort := u.Port()

	for _, fh := range collectForwardedHosts(c) {
		fh = strings.TrimSpace(fh)
		if fh == "" {
			continue
		}
		fwdHost, fwdPort := splitHostPortLoose(fh)
		fwdHost = strings.ToLower(fwdHost)
		if fwdHost != origHost {
			continue
		}
		if origPort == "" && fwdPort == "" {
			return true
		}
		if origPort != "" && fwdPort != "" && strings.EqualFold(origPort, fwdPort) {
			return true
		}
	}
	return false
}

func collectForwardedHosts(c *gin.Context) []string {
	var out []string
	if v := strings.TrimSpace(c.GetHeader("X-Forwarded-Host")); v != "" {
		for _, part := range strings.Split(v, ",") {
			if s := strings.TrimSpace(part); s != "" {
				out = append(out, s)
			}
		}
	}
	// RFC 7239 Forwarded: proto=https;host=example.com
	if v := strings.TrimSpace(c.GetHeader("Forwarded")); v != "" {
		for _, seg := range strings.Split(v, ",") {
			seg = strings.TrimSpace(seg)
			for _, kv := range strings.Split(seg, ";") {
				kv = strings.TrimSpace(kv)
				lower := strings.ToLower(kv)
				if strings.HasPrefix(lower, "host=") {
					h := strings.TrimSpace(kv[5:])
					h = strings.Trim(h, `"'`)
					if h != "" {
						out = append(out, h)
					}
				}
			}
		}
	}
	return out
}

// splitHostPortLoose splits host:port for ASCII hostnames (Vercel, Render).
func splitHostPortLoose(h string) (host, port string) {
	h = strings.TrimSpace(h)
	if strings.HasPrefix(h, "[") {
		if i := strings.Index(h, "]"); i > 0 {
			return h[1:i], strings.TrimPrefix(strings.TrimSpace(h[i+1:]), ":")
		}
	}
	i := strings.LastIndex(h, ":")
	if i <= 0 || i >= len(h)-1 {
		return h, ""
	}
	// IPv6 without brackets — skip heuristics; Vercel never sends that here.
	if strings.Contains(h[:i], ":") {
		return h, ""
	}
	return h[:i], h[i+1:]
}
