package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type bidderCreate struct {
	Name string `json:"name" binding:"required"`
}

func RegisterBidder(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		tenderID := c.Param("id")
		var req bidderCreate
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		id := uuid.NewString()
		_, err := db.Exec(`INSERT INTO bidders (id, tender_id, name) VALUES ($1,$2,$3)`, id, tenderID, req.Name)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		uid := c.GetString("user_id")
		WriteAudit(db, uid, tenderID, "bidder.registered", map[string]any{"bidder_id": id})
		c.JSON(http.StatusCreated, gin.H{"id": id})
	}
}

func ListBidders(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		tenderID := c.Param("id")
		rows, err := db.Query(`SELECT id, name, created_at FROM bidders WHERE tender_id=$1 ORDER BY created_at`, tenderID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		defer rows.Close()
		var out []map[string]any
		for rows.Next() {
			var id, name string
			var created interface{}
			rows.Scan(&id, &name, &created)
			out = append(out, map[string]any{"id": id, "name": name, "created_at": created})
		}
		c.JSON(http.StatusOK, gin.H{"bidders": out})
	}
}

func GetBidder(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		var name, tenderID string
		err := db.QueryRow(`SELECT name, tender_id FROM bidders WHERE id=$1`, id).Scan(&name, &tenderID)
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"id": id, "name": name, "tender_id": tenderID})
	}
}

func UploadBidderDocument(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		bidderID := c.Param("id")
		var tenderID string
		if err := db.QueryRow(`SELECT tender_id FROM bidders WHERE id=$1`, bidderID).Scan(&tenderID); err != nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "bidder not found"})
			return
		}
		fh, err := c.FormFile("file")
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "file required"})
			return
		}
		_ = os.MkdirAll("data/uploads", 0o755)
		docID := uuid.NewString()
		name := fh.Filename
		dest := filepath.Join("data/uploads", docID+"_"+name)
		if err := c.SaveUploadedFile(fh, dest); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		dt := c.PostForm("doc_type")
		if dt == "" {
			dt = "supporting"
		}
		uid := c.GetString("user_id")
		_, err = db.Exec(`INSERT INTO documents (id, owner_type, owner_id, filename, storage_key, doc_type) VALUES ($1,'bidder',$2,$3,$4,$5)`,
			docID, bidderID, name, dest, dt)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		var ocrRes struct {
			Text    string  `json:"text"`
			Quality float64 `json:"quality_score"`
		}
		_ = PostJSON("/v1/process-document", map[string]string{"path": dest, "document_id": docID}, &ocrRes)
		payload, _ := json.Marshal(ocrRes)
		db.Exec(`UPDATE documents SET quality_score=$1, ocr_payload=$2::jsonb WHERE id=$3`, ocrRes.Quality, string(payload), docID)
		WriteAudit(db, uid, tenderID, "bidder.document.uploaded", map[string]any{"document_id": docID, "bidder_id": bidderID})
		c.JSON(http.StatusCreated, gin.H{"document_id": docID, "ocr": ocrRes})
	}
}
