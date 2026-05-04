package handlers

import (
	"context"
	"database/sql"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"github.com/tendersense/backend/internal/objectstore"
	"github.com/tendersense/backend/internal/util"
)

// DocumentPresign returns a short-lived GET URL for S3-backed documents (s3:bucket:key in storage_key).
func DocumentPresign(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		docID := c.Param("id")
		uid := c.GetString("user_id")
		admin := strings.EqualFold(strings.TrimSpace(c.GetString("role")), "admin")

		var storageKey string
		err := db.QueryRow(`
			SELECT d.storage_key
			  FROM documents d
			  LEFT JOIN tenders t1 ON d.owner_type = 'tender' AND d.owner_id = t1.id
			  LEFT JOIN bidders b ON d.owner_type = 'bidder' AND d.owner_id = b.id
			  LEFT JOIN tenders t2 ON b.tender_id = t2.id
			 WHERE d.id = $1::uuid
			   AND ($2 OR COALESCE(t1.owner_id::text, t2.owner_id::text) = $3)`,
			docID, admin, uid,
		).Scan(&storageKey)
		if err == sql.ErrNoRows {
			util.NotFound(c, "document not found")
			return
		}
		if err != nil {
			util.InternalError(c, "lookup failed")
			return
		}

		bucket, key, ok := objectstore.ParseRef(storageKey)
		if !ok {
			util.BadRequest(c, "document is not stored in object storage (no presigned URL)")
			return
		}
		st, ok := objectstore.FromEnv()
		if !ok || st.Bucket != bucket {
			util.InternalError(c, "object storage is not configured")
			return
		}
		ttl := 15 * time.Minute
		ctx, cancel := context.WithTimeout(c.Request.Context(), 10*time.Second)
		defer cancel()
		url, err := st.PresignedGET(ctx, key, ttl)
		if err != nil {
			util.InternalError(c, "could not presign URL")
			return
		}
		c.JSON(http.StatusOK, gin.H{"url": url, "expires_in": int(ttl.Seconds())})
	}
}
