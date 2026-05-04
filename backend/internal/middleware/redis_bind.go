package middleware

import (
	"github.com/redis/go-redis/v9"
	"github.com/tendersense/backend/internal/revocation"
)

var sharedRedis *redis.Client

// BindRedisForAuth wires the optional Redis client into revocation JTI caching and
// short-lived role/TV caching for AuthRequired. Call once from main with the same
// client used for rate limits (or nil to keep DB-only paths).
func BindRedisForAuth(c *redis.Client) {
	sharedRedis = c
	revocation.SetOptionalRedis(c)
}
