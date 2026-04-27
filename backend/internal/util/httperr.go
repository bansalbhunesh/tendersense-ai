package util

import (
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

// Error codes used by the structured error response.
const (
	CodeBadRequest   = "bad_request"
	CodeUnauthorized = "unauthorized"
	CodeForbidden    = "forbidden"
	CodeNotFound     = "not_found"
	CodeConflict     = "conflict"
	CodeInternal     = "internal_error"
)

// ErrorBody is the structured error envelope returned for 4xx/5xx responses.
type ErrorBody struct {
	Error ErrorPayload `json:"error"`
}

// ErrorPayload describes the error code, human message and request_id correlation token.
type ErrorPayload struct {
	Code      string `json:"code"`
	Message   string `json:"message"`
	RequestID string `json:"request_id,omitempty"`
}

// requestIDKey mirrors the key used by middleware.RequestObservability so we
// can read it without introducing an import cycle.
const requestIDContextKey = "request_id"

// requestIDFromContext extracts the request id set by the observability
// middleware. If absent (e.g. unit tests that bypass the middleware) it
// generates a fresh uuid so responses always carry a correlation token.
func requestIDFromContext(c *gin.Context) string {
	if c == nil {
		return ""
	}
	if v, ok := c.Get(requestIDContextKey); ok {
		if s, ok := v.(string); ok && s != "" {
			return s
		}
	}
	if c.Writer != nil {
		if h := c.Writer.Header().Get("X-Request-ID"); h != "" {
			return h
		}
	}
	return uuid.NewString()
}

// WriteError emits the canonical JSON error envelope and aborts the request.
func WriteError(c *gin.Context, status int, code, message string) {
	rid := requestIDFromContext(c)
	c.AbortWithStatusJSON(status, ErrorBody{
		Error: ErrorPayload{
			Code:      code,
			Message:   message,
			RequestID: rid,
		},
	})
}

// Convenience wrappers for the most common cases.

func BadRequest(c *gin.Context, message string) {
	WriteError(c, http.StatusBadRequest, CodeBadRequest, message)
}

func Unauthorized(c *gin.Context, message string) {
	if message == "" {
		message = "unauthorized"
	}
	WriteError(c, http.StatusUnauthorized, CodeUnauthorized, message)
}

func Forbidden(c *gin.Context, message string) {
	if message == "" {
		message = "forbidden"
	}
	WriteError(c, http.StatusForbidden, CodeForbidden, message)
}

func NotFound(c *gin.Context, message string) {
	if message == "" {
		message = "not found"
	}
	WriteError(c, http.StatusNotFound, CodeNotFound, message)
}

func Conflict(c *gin.Context, message string) {
	WriteError(c, http.StatusConflict, CodeConflict, message)
}

func InternalError(c *gin.Context, message string) {
	if message == "" {
		message = "internal error"
	}
	WriteError(c, http.StatusInternalServerError, CodeInternal, message)
}
