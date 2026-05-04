package middleware

import (
	"context"
	"fmt"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
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

// EvaluateRouteLimiter caps expensive POST /tenders/:id/evaluate per authenticated user.
// When rdb is non-nil, limits are enforced cluster-wide via Redis (calendar-minute window).
// Otherwise an in-process token bucket is used (single replica only).
func EvaluateRouteLimiter(perMinute int, burst int, rdb *redis.Client) gin.HandlerFunc {
	if perMinute <= 0 {
		perMinute = 8
	}
	if burst <= 0 {
		burst = 4
	}
	interval := rate.Every(time.Minute / time.Duration(perMinute))
	maxPerMinuteWindow := perMinute + burst
	if maxPerMinuteWindow < perMinute {
		maxPerMinuteWindow = perMinute
	}

	return func(c *gin.Context) {
		uid := c.GetString("user_id")
		if uid == "" {
			c.Next()
			return
		}
		if rdb != nil {
			if !redisEvalAllow(c.Request.Context(), rdb, uid, maxPerMinuteWindow) {
				util.TooManyRequests(c, "evaluation rate limit exceeded; try again later")
				return
			}
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

func redisEvalAllow(ctx context.Context, rdb *redis.Client, uid string, maxPerWindow int) bool {
	bucket := time.Now().Unix() / 60
	key := fmt.Sprintf("ts:eval:%s:%d", uid, bucket)
	pipe := rdb.Pipeline()
	incr := pipe.Incr(ctx, key)
	pipe.Expire(ctx, key, 2*time.Minute)
	if _, err := pipe.Exec(ctx); err != nil {
		return true
	}
	n, err := incr.Result()
	if err != nil {
		return true
	}
	return int(n) <= maxPerWindow
}
