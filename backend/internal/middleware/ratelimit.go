package middleware

import (
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/time/rate"

	"github.com/tendersense/backend/internal/util"
)

type ipLimiter struct {
	lim      *rate.Limiter
	lastSeen time.Time
}

var (
	authMu       sync.Mutex
	authVisitors = make(map[string]*ipLimiter)
)

func init() {
	go func() {
		t := time.NewTicker(2 * time.Minute)
		defer t.Stop()
		for range t.C {
			authMu.Lock()
			for ip, v := range authVisitors {
				if time.Since(v.lastSeen) > 5*time.Minute {
					delete(authVisitors, ip)
				}
			}
			authMu.Unlock()
		}
	}()
}

// AuthRouteLimiter limits brute-force on /auth/* (per client IP).
func AuthRouteLimiter(rpm int, burst int) gin.HandlerFunc {
	if rpm <= 0 {
		rpm = 30
	}
	if burst <= 0 {
		burst = 12
	}
	interval := rate.Every(time.Minute / time.Duration(rpm))
	return func(c *gin.Context) {
		ip := c.ClientIP()
		authMu.Lock()
		v, ok := authVisitors[ip]
		if !ok {
			v = &ipLimiter{lim: rate.NewLimiter(interval, burst)}
			authVisitors[ip] = v
		}
		v.lastSeen = time.Now()
		lim := v.lim
		authMu.Unlock()
		if !lim.Allow() {
			util.TooManyRequests(c, "too many authentication attempts; try again later")
			return
		}
		c.Next()
	}
}
