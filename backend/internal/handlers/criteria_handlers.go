package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/tendersense/backend/internal/util"
)

type createCriterionBody struct {
	Field                string  `json:"field" binding:"required"`
	Operator             string  `json:"operator" binding:"required"`
	Value                any     `json:"value" binding:"required"`
	Unit                 string  `json:"unit"`
	TextRaw              string  `json:"text_raw"`
	ExtractionConfidence float64 `json:"extraction_confidence"`
}

// CreateCriterionManual inserts a criterion row from officer-entered JSON (no AI extract).
func CreateCriterionManual(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		tenderID := c.Param("id")
		if !RequireTenderOwner(db, c, tenderID) {
			return
		}
		var req createCriterionBody
		if err := c.ShouldBindJSON(&req); err != nil {
			util.BadRequest(c, err.Error())
			return
		}
		dup, err := criteriaDuplicateCount(db, tenderID, req.Field, req.Operator, req.Value)
		if err != nil {
			util.InternalError(c, err.Error())
			return
		}
		if dup > 0 {
			util.Conflict(c, "a criterion with the same field, operator, and value already exists")
			return
		}
		cid := uuid.NewString()
		conf := req.ExtractionConfidence
		if conf <= 0 || conf > 1 {
			conf = 1
		}
		m := map[string]any{
			"id":                     cid,
			"field":                  req.Field,
			"operator":               req.Operator,
			"value":                  req.Value,
			"unit":                   req.Unit,
			"text_raw":               req.TextRaw,
			"extraction_confidence":  conf,
		}
		b, err := json.Marshal(m)
		if err != nil {
			util.InternalError(c, err.Error())
			return
		}
		if _, err := db.Exec(`INSERT INTO criteria (id, tender_id, payload) VALUES ($1,$2,$3::jsonb)`, cid, tenderID, string(b)); err != nil {
			util.InternalError(c, err.Error())
			return
		}
		uid := c.GetString("user_id")
		WriteAudit(db, uid, tenderID, "criterion.created_manual", map[string]any{"criterion_id": cid})
		c.JSON(http.StatusCreated, gin.H{"id": cid})
	}
}

// PatchCriterion merges JSON keys into an existing criterion payload (id is preserved).
func PatchCriterion(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		tenderID := c.Param("id")
		critID := c.Param("cid")
		if !RequireTenderOwner(db, c, tenderID) {
			return
		}
		var patch map[string]any
		if err := c.ShouldBindJSON(&patch); err != nil {
			util.BadRequest(c, err.Error())
			return
		}
		delete(patch, "id")
		var payloadB []byte
		err := db.QueryRow(`SELECT payload FROM criteria WHERE id=$1 AND tender_id=$2`, critID, tenderID).Scan(&payloadB)
		if err == sql.ErrNoRows {
			util.NotFound(c, "criterion not found")
			return
		}
		if err != nil {
			util.InternalError(c, err.Error())
			return
		}
		var m map[string]any
		if err := json.Unmarshal(payloadB, &m); err != nil {
			util.InternalError(c, "invalid stored payload")
			return
		}
		for k, v := range patch {
			m[k] = v
		}
		m["id"] = critID
		out, err := json.Marshal(m)
		if err != nil {
			util.InternalError(c, err.Error())
			return
		}
		if _, err := db.Exec(`UPDATE criteria SET payload=$1::jsonb WHERE id=$2 AND tender_id=$3`, string(out), critID, tenderID); err != nil {
			util.InternalError(c, err.Error())
			return
		}
		uid := c.GetString("user_id")
		WriteAudit(db, uid, tenderID, "criterion.updated", map[string]any{"criterion_id": critID})
		c.JSON(http.StatusOK, gin.H{"ok": true})
	}
}

// DeleteCriterion removes a criterion row owned by the tender.
func DeleteCriterion(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		tenderID := c.Param("id")
		critID := c.Param("cid")
		if !RequireTenderOwner(db, c, tenderID) {
			return
		}
		res, err := db.Exec(`DELETE FROM criteria WHERE id=$1 AND tender_id=$2`, critID, tenderID)
		if err != nil {
			util.InternalError(c, err.Error())
			return
		}
		n, _ := res.RowsAffected()
		if n == 0 {
			util.NotFound(c, "criterion not found")
			return
		}
		uid := c.GetString("user_id")
		WriteAudit(db, uid, tenderID, "criterion.deleted", map[string]any{"criterion_id": critID})
		c.JSON(http.StatusOK, gin.H{"ok": true})
	}
}
