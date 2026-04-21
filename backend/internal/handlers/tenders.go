package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/tendersense/backend/internal/util"
)

type tenderCreate struct {
	Title       string `json:"title" binding:"required,min=3,max=256"`
	Description string `json:"description" binding:"max=8000"`
}

func CreateTender(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req tenderCreate
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		uid := c.GetString("user_id")
		id := uuid.NewString()
		_, err := db.Exec(`INSERT INTO tenders (id, title, description, owner_id, status) VALUES ($1,$2,$3,$4,'open')`,
			id, req.Title, req.Description, uid)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		WriteAudit(db, uid, id, "tender.created", map[string]any{"tender_id": id})
		c.JSON(http.StatusCreated, gin.H{"id": id})
	}
}

func ListTenders(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		uid := c.GetString("user_id")
		rows, err := db.Query(`SELECT id, title, status, created_at FROM tenders WHERE owner_id=$1 ORDER BY created_at DESC`, uid)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
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
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
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
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
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
				m["id"] = cid
				b, _ := json.Marshal(m)
				criteria = append(criteria, b)
			}
			_ = rows.Err()
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
			c.JSON(http.StatusBadRequest, gin.H{"error": "file required"})
			return
		}
		_ = os.MkdirAll("data/uploads", 0o755)
		docID := uuid.NewString()
		name, ok := safeUploadFilename(fh.Filename)
		if !ok {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid or disallowed file type; allowed: pdf, png, jpg, jpeg, tif, tiff"})
			return
		}
		dest := filepath.Join("data/uploads", docID+"_"+name)
		uid := c.GetString("user_id")

		// Insert DB record FIRST — if file save fails we can clean up, but we
		// cannot un-write a file that was saved before a failing DB insert.
		_, err = db.Exec(`INSERT INTO documents (id, owner_type, owner_id, filename, storage_key, doc_type) VALUES ($1,'tender',$2,$3,$4,'tender')`,
			docID, tenderID, name, dest)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		if err := c.SaveUploadedFile(fh, dest); err != nil {
			// DB row inserted but file failed — clean up the DB row
			db.Exec(`DELETE FROM documents WHERE id=$1`, docID)
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		var ocrRes struct {
			Text    string  `json:"text"`
			Quality float64 `json:"quality_score"`
			Pages   []any   `json:"pages"`
			Engine  string  `json:"engine"`
		}
		_ = util.PostJSON(c.Request.Context(), "/v1/process-document", map[string]string{"path": dest, "document_id": docID}, &ocrRes)
		payload, _ := json.Marshal(ocrRes)
		db.Exec(`UPDATE documents SET quality_score=$1, ocr_payload=$2::jsonb WHERE id=$3`, ocrRes.Quality, string(payload), docID)

		WriteAudit(db, uid, tenderID, "document.uploaded", map[string]any{"document_id": docID, "tender_id": tenderID})

		extRes := struct {
			Criteria []map[string]any `json:"criteria"`
		}{}
		if ocrRes.Text != "" {
			_ = util.PostJSON(c.Request.Context(), "/v1/extract-criteria", map[string]string{"text": ocrRes.Text, "tender_id": tenderID}, &extRes)
			for _, cr := range extRes.Criteria {
				if cr["id"] == nil || cr["id"] == "" {
					cr["id"] = uuid.NewString()
				}
				b, _ := json.Marshal(cr)
				cid, _ := cr["id"].(string)
				if cid == "" {
					cid = uuid.NewString()
				}
				db.Exec(`INSERT INTO criteria (id, tender_id, payload) VALUES ($1,$2,$3::jsonb)`, cid, tenderID, string(b))
			}
		}

		c.JSON(http.StatusCreated, gin.H{"document_id": docID, "ocr": ocrRes, "criteria_extracted": len(extRes.Criteria)})
	}
}

func WriteAudit(db *sql.DB, userID, tenderID, action string, payload map[string]any) {
	b, _ := json.Marshal(payload)
	sum := util.ChecksumJSON(map[string]any{"action": action, "payload": json.RawMessage(b)})
	db.Exec(`INSERT INTO audit_log (tender_id, user_id, action, payload, checksum) VALUES ($1::uuid,$2::uuid,$3,$4::jsonb,$5)`,
		nullUUID(tenderID), nullUUID(userID), action, string(b), sum)
}

func nullUUID(s string) any {
	if s == "" {
		return nil
	}
	return s
}
