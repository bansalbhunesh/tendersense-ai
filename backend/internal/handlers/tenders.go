package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/tendersense/backend/internal/util"
	"github.com/tendersense/backend/internal/util/pii"
)

type tenderCreate struct {
	Title       string `json:"title" binding:"required,min=3,max=256"`
	Description string `json:"description" binding:"max=8000"`
}

func CreateTender(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req tenderCreate
		if err := c.ShouldBindJSON(&req); err != nil {
			util.BadRequest(c, err.Error())
			return
		}
		uid := c.GetString("user_id")
		id := uuid.NewString()
		_, err := db.Exec(`INSERT INTO tenders (id, title, description, owner_id, status) VALUES ($1,$2,$3,$4,'open')`,
			id, req.Title, req.Description, uid)
		if err != nil {
			util.InternalError(c, err.Error())
			return
		}
		WriteAudit(db, uid, id, "tender.created", map[string]any{"tender_id": id})
		c.JSON(http.StatusCreated, gin.H{"id": id})
	}
}

func ListTenders(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		uid := c.GetString("user_id")
		admin := strings.EqualFold(strings.TrimSpace(c.GetString("role")), "admin")
		page, err := util.ParsePagination(c)
		if err != nil {
			util.BadRequest(c, err.Error())
			return
		}
		var total int
		var rows *sql.Rows
		if admin {
			if err := db.QueryRow(`SELECT COUNT(*) FROM tenders`).Scan(&total); err != nil {
				util.InternalError(c, err.Error())
				return
			}
			rows, err = db.Query(
				`SELECT id, title, status, created_at FROM tenders ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
				page.Limit, page.Offset,
			)
		} else {
			if err := db.QueryRow(`SELECT COUNT(*) FROM tenders WHERE owner_id=$1`, uid).Scan(&total); err != nil {
				util.InternalError(c, err.Error())
				return
			}
			rows, err = db.Query(
				`SELECT id, title, status, created_at FROM tenders WHERE owner_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
				uid, page.Limit, page.Offset,
			)
		}
		if err != nil {
			util.InternalError(c, err.Error())
			return
		}
		defer rows.Close()
		out := make([]map[string]any, 0)
		for rows.Next() {
			var id, title, status string
			var created interface{}
			if err := rows.Scan(&id, &title, &status, &created); err != nil {
				continue
			}
			out = append(out, map[string]any{"id": id, "title": title, "status": status, "created_at": created})
		}
		if err := rows.Err(); err != nil {
			util.InternalError(c, err.Error())
			return
		}
		util.SetTotalCountHeader(c, total)
		c.JSON(http.StatusOK, gin.H{"tenders": out})
	}
}

func GetTender(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		id := c.Param("id")
		if !RequireTenderOwner(db, c, id) {
			return
		}
		var title, desc, status string
		var created interface{}
		err := db.QueryRow(`SELECT title, description, status, created_at FROM tenders WHERE id=$1`, id).Scan(&title, &desc, &status, &created)
		if err == sql.ErrNoRows {
			util.NotFound(c, "not found")
			return
		}
		if err != nil {
			util.InternalError(c, err.Error())
			return
		}
		rows, err := db.Query(`SELECT id, payload FROM criteria WHERE tender_id=$1`, id)
		criteria := make([]json.RawMessage, 0)
		if err == nil && rows != nil {
			defer rows.Close()
			for rows.Next() {
				var cid string
				var payload []byte
				if err := rows.Scan(&cid, &payload); err != nil {
					continue
				}
				var m map[string]any
				if err := json.Unmarshal(payload, &m); err != nil {
					continue
				}
				delete(m, "id")
				m["id"] = cid
				b, _ := json.Marshal(m)
				criteria = append(criteria, b)
			}
			if err := rows.Err(); err != nil {
				util.InternalError(c, err.Error())
				return
			}
		}
		c.JSON(http.StatusOK, gin.H{
			"id": id, "title": title, "description": desc, "status": status, "created_at": created,
			"criteria": criteria,
		})
	}
}

func UploadTenderDocument(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		tenderID := c.Param("id")
		if !RequireTenderOwner(db, c, tenderID) {
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
		name, ok := safeUploadFilename(fh.Filename)
		if !ok {
			util.BadRequest(c, "invalid or disallowed file type; allowed: pdf, png, jpg, jpeg, tif, tiff")
			return
		}
		dest := filepath.Join(root, docID+"_"+name)
		uid := c.GetString("user_id")

		// Insert DB record FIRST — if file save fails we can clean up, but we
		// cannot un-write a file that was saved before a failing DB insert.
		_, err = db.Exec(`INSERT INTO documents (id, owner_type, owner_id, filename, storage_key, doc_type) VALUES ($1,'tender',$2,$3,$4,'tender')`,
			docID, tenderID, name, dest)
		if err != nil {
			util.InternalError(c, "could not save document record")
			return
		}

		if err := c.SaveUploadedFile(fh, dest); err != nil {
			// DB row inserted but file failed — clean up the DB row
			db.Exec(`DELETE FROM documents WHERE id=$1`, docID)
			util.InternalError(c, "could not store uploaded file")
			return
		}

		var ocrRes struct {
			Text    string  `json:"text"`
			Quality float64 `json:"quality_score"`
			Pages   []any   `json:"pages"`
			Engine  string  `json:"engine"`
		}
		if err := util.PostDocumentFile(c.Request.Context(), dest, docID, &ocrRes); err != nil {
			util.BadGateway(c, "OCR service is temporarily unavailable; please try again in a moment")
			return
		}
		payload, _ := json.Marshal(ocrRes)
		if _, err := db.Exec(`UPDATE documents SET quality_score=$1, ocr_payload=$2::jsonb WHERE id=$3`, ocrRes.Quality, string(payload), docID); err != nil {
			log.Printf("document_ocr_persist_failed document_id=%s err=%v", docID, err)
		} else {
			tryMirrorDocumentToS3(db, docID, dest, name)
		}

		WriteAudit(db, uid, tenderID, "document.uploaded", map[string]any{"document_id": docID, "tender_id": tenderID})

		extRes := struct {
			Criteria []map[string]any `json:"criteria"`
		}{}
		insertedCount := 0
		if ocrRes.Text != "" {
			if err := util.PostJSON(c.Request.Context(), "/v1/extract-criteria", map[string]string{"text": ocrRes.Text, "tender_id": tenderID}, &extRes); err != nil {
				util.BadGateway(c, "criteria extraction is temporarily unavailable; please try again later")
				return
			}
			for _, cr := range extRes.Criteria {
				if cr == nil {
					continue
				}
				field, _ := cr["field"].(string)
				op, _ := cr["operator"].(string)
				dup, err := criteriaDuplicateCount(db, tenderID, field, op, cr["value"])
				if err != nil {
					continue
				}
				if dup > 0 {
					continue
				}
				cid := uuid.NewString()
				cr["id"] = cid
				b, err := json.Marshal(cr)
				if err != nil {
					continue
				}
				if _, err := db.Exec(`INSERT INTO criteria (id, tender_id, payload) VALUES ($1,$2,$3::jsonb)`, cid, tenderID, string(b)); err == nil {
					insertedCount++
				}
			}
		}

		c.JSON(http.StatusCreated, gin.H{"document_id": docID, "ocr": ocrRes, "criteria_extracted": insertedCount})
	}
}

// WriteAudit serialises the payload to JSON, redacts PAN/Aadhaar/GSTIN
// occurrences in any string-valued node, and writes the row + checksum.
// The checksum is computed over the redacted bytes so audit verification
// stays internally consistent without leaking the raw identifier.
func WriteAudit(db *sql.DB, userID, tenderID, action string, payload map[string]any) {
	b, _ := json.Marshal(payload)
	b = pii.RedactJSON(b)
	sum := util.ChecksumJSON(map[string]any{"action": action, "payload": json.RawMessage(b)})
	if _, err := db.Exec(`INSERT INTO audit_log (tender_id, user_id, action, payload, checksum) VALUES ($1::uuid,$2::uuid,$3,$4::jsonb,$5)`,
		nullUUID(tenderID), nullUUID(userID), action, string(b), sum); err != nil {
		log.Printf("audit_write_failed action=%s tender_id=%s err=%v", action, tenderID, err)
	}
}

// criteriaDuplicateCount detects an existing criterion with the same field/operator/value.
// Numeric JSON values are compared as PostgreSQL numeric so 5e+07 and 50000000 match.
func criteriaDuplicateCount(db *sql.DB, tenderID, field, op string, valRaw any) (int, error) {
	var dup int
	switch v := valRaw.(type) {
	case float64:
		err := db.QueryRow(`
			SELECT COUNT(*)::int FROM criteria
			WHERE tender_id=$1
			  AND COALESCE(payload->>'field','') = $2
			  AND COALESCE(payload->>'operator','') = $3
			  AND jsonb_typeof(payload->'value') = 'number'
			  AND (payload->'value')::numeric = $4::numeric
		`, tenderID, field, op, v).Scan(&dup)
		return dup, err
	case int:
		return criteriaDuplicateCount(db, tenderID, field, op, float64(v))
	case int64:
		return criteriaDuplicateCount(db, tenderID, field, op, float64(v))
	case json.Number:
		f, err := v.Float64()
		if err != nil {
			break
		}
		return criteriaDuplicateCount(db, tenderID, field, op, f)
	}
	val := fmt.Sprint(valRaw)
	err := db.QueryRow(`
		SELECT COUNT(*)::int FROM criteria
		WHERE tender_id=$1
		  AND COALESCE(payload->>'field','') = $2
		  AND COALESCE(payload->>'operator','') = $3
		  AND COALESCE(payload->>'value','') = $4
	`, tenderID, field, op, val).Scan(&dup)
	return dup, err
}

func nullUUID(s string) any {
	if s == "" {
		return nil
	}
	return s
}
