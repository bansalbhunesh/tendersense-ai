package handlers

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"path/filepath"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/tendersense/backend/internal/util"
)

type bidderCreate struct {
	Name string `json:"name" binding:"required,min=1,max=512"`
}

func RegisterBidder(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		tenderID := c.Param("id")
		if !RequireTenderOwner(db, c, tenderID) {
			return
		}
		var req bidderCreate
		if err := c.ShouldBindJSON(&req); err != nil {
			util.BadRequest(c, err.Error())
			return
		}
		id := uuid.NewString()
		_, err := db.Exec(`INSERT INTO bidders (id, tender_id, name) VALUES ($1,$2,$3)`, id, tenderID, req.Name)
		if err != nil {
			util.InternalError(c, err.Error())
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
		if !RequireTenderOwner(db, c, tenderID) {
			return
		}
		page, err := util.ParsePagination(c)
		if err != nil {
			util.BadRequest(c, err.Error())
			return
		}
		var total int
		if err := db.QueryRow(`SELECT COUNT(*) FROM bidders WHERE tender_id=$1`, tenderID).Scan(&total); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				total = 0
			} else {
				util.InternalError(c, err.Error())
				return
			}
		}
		rows, err := db.Query(
			`SELECT id, name, created_at FROM bidders WHERE tender_id=$1 ORDER BY created_at LIMIT $2 OFFSET $3`,
			tenderID, page.Limit, page.Offset,
		)
		if err != nil {
			util.InternalError(c, err.Error())
			return
		}
		defer rows.Close()
		out := make([]map[string]any, 0)
		for rows.Next() {
			var id, name string
			var created interface{}
			if err := rows.Scan(&id, &name, &created); err != nil {
				continue
			}
			out = append(out, map[string]any{"id": id, "name": name, "created_at": created})
		}
		if err := rows.Err(); err != nil && !errors.Is(err, sql.ErrNoRows) {
			util.InternalError(c, err.Error())
			return
		}
		util.SetTotalCountHeader(c, total)
		c.JSON(http.StatusOK, gin.H{"bidders": out})
	}
}

func GetBidder(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("bid")
		tenderID, ok := RequireBidderForOwner(db, c, id)
		if !ok {
			return
		}
		var name string
		err := db.QueryRow(`SELECT name FROM bidders WHERE id=$1`, id).Scan(&name)
		if errors.Is(err, sql.ErrNoRows) {
			util.NotFound(c, "not found")
			return
		}
		if err != nil {
			util.InternalError(c, "lookup failed")
			return
		}
		c.JSON(http.StatusOK, gin.H{"id": id, "name": name, "tender_id": tenderID})
	}
}

func UploadBidderDocument(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		bidderID := c.Param("id")
		tenderID, ok := RequireBidderForOwner(db, c, bidderID)
		if !ok {
			return
		}
		fh, err := c.FormFile("file")
		if err != nil {
			util.BadRequest(c, "file required")
			return
		}
		if !rejectOversizeUpload(c, fh) {
			return
		}
		root := UploadDataDir()
		_ = os.MkdirAll(root, 0o755)
		docID := uuid.NewString()
		name, okName := safeUploadFilename(fh.Filename)
		if !okName {
			util.BadRequest(c, "invalid or disallowed file type; allowed: pdf, png, jpg, jpeg, tif, tiff")
			return
		}
		dest := filepath.Join(root, docID+"_"+name)
		dt, okDT := NormalizeBidderDocType(c.PostForm("doc_type"))
		if !okDT {
			util.BadRequest(c, "invalid doc_type")
			return
		}
		uid := c.GetString("user_id")

		// Insert DB record FIRST — prevents orphan files if DB fails
		_, err = db.Exec(`INSERT INTO documents (id, owner_type, owner_id, filename, storage_key, doc_type) VALUES ($1,'bidder',$2,$3,$4,$5)`,
			docID, bidderID, name, dest, dt)
		if err != nil {
			util.InternalError(c, "could not save document record")
			return
		}

		if err := c.SaveUploadedFile(fh, dest); err != nil {
			db.Exec(`DELETE FROM documents WHERE id=$1`, docID)
			util.InternalError(c, "could not store uploaded file")
			return
		}

		var ocrRes struct {
			Text    string           `json:"text"`
			Quality float64          `json:"quality_score"`
			Engine  string           `json:"engine"`
			Pages   []map[string]any `json:"pages"`
		}
		if err := util.PostDocumentFile(c.Request.Context(), dest, docID, &ocrRes); err != nil {
			log.Printf("bidder_doc_ocr_upstream_failed tender_id=%s bidder_id=%s document_id=%s err=%v", tenderID, bidderID, docID, err)
			util.BadGateway(c, "OCR service is temporarily unavailable; please try again in a moment")
			return
		}
		payload, _ := json.Marshal(ocrRes)
		if _, err := db.Exec(`UPDATE documents SET quality_score=$1, ocr_payload=$2::jsonb WHERE id=$3`, ocrRes.Quality, string(payload), docID); err != nil {
			log.Printf("document_ocr_persist_failed document_id=%s err=%v", docID, err)
		} else {
			tryMirrorDocumentToS3(db, docID, dest, name)
		}
		WriteAudit(db, uid, tenderID, "bidder.document.uploaded", map[string]any{"document_id": docID, "bidder_id": bidderID})
		c.JSON(http.StatusCreated, gin.H{"document_id": docID, "ocr": ocrRes})
	}
}

// ListBidderDocuments returns uploaded documents for a bidder in the tender workspace.
func ListBidderDocuments(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		tenderID := c.Param("id")
		bid := c.Param("bid")
		if !RequireTenderOwner(db, c, tenderID) {
			return
		}
		var n int
		if err := db.QueryRow(`SELECT COUNT(*) FROM bidders WHERE id=$1 AND tender_id=$2`, bid, tenderID).Scan(&n); err != nil {
			util.InternalError(c, err.Error())
			return
		}
		if n == 0 {
			util.NotFound(c, "bidder not found")
			return
		}
		rows, err := db.Query(
			`SELECT id::text, filename, COALESCE(doc_type,''), created_at, COALESCE(quality_score,0)
			 FROM documents WHERE owner_type='bidder' AND owner_id=$1::uuid ORDER BY doc_type NULLS LAST, created_at DESC`,
			bid,
		)
		if err != nil {
			util.InternalError(c, err.Error())
			return
		}
		defer rows.Close()
		out := make([]map[string]any, 0)
		for rows.Next() {
			var id, filename, docType string
			var created interface{}
			var qs float64
			if err := rows.Scan(&id, &filename, &docType, &created, &qs); err != nil {
				continue
			}
			out = append(out, map[string]any{
				"id": id, "filename": filename, "doc_type": docType, "created_at": created, "quality_score": qs,
			})
		}
		if err := rows.Err(); err != nil {
			util.InternalError(c, err.Error())
			return
		}
		c.JSON(http.StatusOK, gin.H{"documents": out})
	}
}
