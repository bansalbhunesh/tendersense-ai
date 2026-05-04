package middleware

import (
	"log"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const requestIDKey = "request_id"

// RequestObservability injects request IDs and emits structured request logs.
func RequestObservability() gin.HandlerFunc {
	return func(c *gin.Context) {
		rid := strings.TrimSpace(c.GetHeader("X-Request-ID"))
		if rid == "" || uuid.Validate(rid) != nil {
			rid = uuid.NewString()
		}
		c.Set(requestIDKey, rid)
		c.Writer.Header().Set("X-Request-ID", rid)

		start := time.Now()
		c.Next()
		latency := time.Since(start).Milliseconds()
		log.Printf(
			`{"event":"http_request","request_id":"%s","method":"%s","path":"%s","status":%d,"latency_ms":%d,"client_ip":"%s"}`,
			rid, c.Request.Method, c.FullPath(), c.Writer.Status(), latency, c.ClientIP(),
		)
	}
}

func RequestID(c *gin.Context) string {
	if v, ok := c.Get(requestIDKey); ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}
