package util

import (
	"errors"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

// Pagination describes a parsed limit/offset pair.
type Pagination struct {
	Limit  int
	Offset int
}

// Pagination defaults and ceilings.
const (
	DefaultPaginationLimit = 50
	MaxPaginationLimit     = 200
)

// ParsePagination reads ?limit and ?offset from the query string, applies
// defaults (limit=50, offset=0), caps limit at 200 and rejects negatives.
// Returns an error suitable for surfacing back as a 400.
func ParsePagination(c *gin.Context) (Pagination, error) {
	p := Pagination{Limit: DefaultPaginationLimit, Offset: 0}

	if raw := strings.TrimSpace(c.Query("limit")); raw != "" {
		v, err := strconv.Atoi(raw)
		if err != nil {
			return p, errors.New("invalid limit")
		}
		if v < 0 {
			return p, errors.New("limit must be >= 0")
		}
		if v == 0 {
			v = DefaultPaginationLimit
		}
		if v > MaxPaginationLimit {
			v = MaxPaginationLimit
		}
		p.Limit = v
	}

	if raw := strings.TrimSpace(c.Query("offset")); raw != "" {
		v, err := strconv.Atoi(raw)
		if err != nil {
			return p, errors.New("invalid offset")
		}
		if v < 0 {
			return p, errors.New("offset must be >= 0")
		}
		p.Offset = v
	}
	return p, nil
}

// SetTotalCountHeader writes the X-Total-Count response header.
func SetTotalCountHeader(c *gin.Context, total int) {
	c.Writer.Header().Set("X-Total-Count", strconv.Itoa(total))
}
