package middleware

import (
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"golang.org/x/time/rate"

	"github.com/tendersense/backend/internal/util"
)

type userEvalLimiter struct {
	lim      *rate.Limiter
	lastSeen time.Time
}

var (
	evalMu       sync.Mutex
	evalVisitors = make(map[string]*userEvalLimiter)
)

func init() {
	go func() {
		t := time.NewTicker(5 * time.Minute)
		defer t.Stop()
		for range t.C {
			evalMu.Lock()
			for uid, v := range evalVisitors {
				if time.Since(v.lastSeen) > 30*time.Minute {
					delete(evalVisitors, uid)
				}
			}
			evalMu.Unlock()
		}
	}()
}

// EvaluateRouteLimiter caps expensive POST /tenders/:id/evaluate per authenticated user (burst + sustained).
func EvaluateRouteLimiter(perMinute int, burst int) gin.HandlerFunc {
	if perMinute <= 0 {
		perMinute = 8
	}
	if burst <= 0 {
		burst = 4
	}
	interval := rate.Every(time.Minute / time.Duration(perMinute))
	return func(c *gin.Context) {
		uid := c.GetString("user_id")
		if uid == "" {
			c.Next()
			return
		}
		evalMu.Lock()
		v, ok := evalVisitors[uid]
		if !ok {
			v = &userEvalLimiter{lim: rate.NewLimiter(interval, burst)}
			evalVisitors[uid] = v
		}
		v.lastSeen = time.Now()
		lim := v.lim
		evalMu.Unlock()
		if !lim.Allow() {
			util.TooManyRequests(c, "evaluation rate limit exceeded; try again later")
			return
		}
		c.Next()
	}
}
