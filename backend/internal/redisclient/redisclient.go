package redisclient

import (
	"log"
	"os"
	"strings"

	"github.com/redis/go-redis/v9"
)

// NewOptional returns a Redis client when REDIS_URL is set and valid, else nil.
func NewOptional() *redis.Client {
	raw := strings.TrimSpace(os.Getenv("REDIS_URL"))
	if raw == "" {
		return nil
	}
	opt, err := redis.ParseURL(raw)
	if err != nil {
		log.Printf("REDIS_URL parse error (eval limiter / shared cache disabled): %v", err)
		return nil
	}
	return redis.NewClient(opt)
}
