package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func TriggerEvaluation(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		tenderID := c.Param("id")
		if !RequireTenderOwner(db, c, tenderID) {
			return
		}
		uid, _ := c.Get("user_id")
		userID, _ := uid.(string)

		// 1. Data Gathering (Read-only, can be outside TX if needed, but safe here)
		crows, err := db.QueryContext(c.Request.Context(), `SELECT id, payload FROM criteria WHERE tender_id=$1`, tenderID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch criteria"})
			return
		}
		var criteria []map[string]any
		for crows.Next() {
			var id string
			var payload []byte
			if err := crows.Scan(&id, &payload); err != nil {
				continue
			}
			var m map[string]any
			if err := json.Unmarshal(payload, &m); err == nil {
				m["id"] = id
				criteria = append(criteria, m)
			}
		}
		if err := crows.Err(); err != nil {
			crows.Close()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "error reading criteria"})
			return
		}
		crows.Close()

		if len(criteria) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "no criteria — upload tender document first"})
			return
		}

		brows, err := db.QueryContext(c.Request.Context(), `SELECT id FROM bidders WHERE tender_id=$1`, tenderID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to fetch bidders"})
			return
		}
		var bidderIDs []string
		for brows.Next() {
			var id string
			if err := brows.Scan(&id); err != nil {
				continue
			}
			bidderIDs = append(bidderIDs, id)
		}
		if err := brows.Err(); err != nil {
			brows.Close()
			c.JSON(http.StatusInternalServerError, gin.H{"error": "error reading bidders"})
			return
		}
		brows.Close()

		if len(bidderIDs) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "no bidders registered for this tender"})
			return
		}

		biddersPayload := []map[string]any{}
		for _, bid := range bidderIDs {
			drows, err := db.QueryContext(c.Request.Context(), `SELECT id, filename, doc_type, ocr_payload FROM documents WHERE owner_type='bidder' AND owner_id=$1`, bid)
			if err != nil {
				continue
			}
			docs := make([]map[string]any, 0)
			for drows.Next() {
				var id, fname, dtype string
				var ocrRaw []byte
				if err := drows.Scan(&id, &fname, &dtype, &ocrRaw); err != nil {
					continue
				}
				var ocr map[string]any
				if len(ocrRaw) > 0 {
					_ = json.Unmarshal(ocrRaw, &ocr)
				}
				docs = append(docs, map[string]any{
					"id": id, "filename": fname, "doc_type": dtype, "ocr": ocr,
				})
			}
			_ = drows.Err()
			drows.Close()
			biddersPayload = append(biddersPayload, map[string]any{"bidder_id": bid, "documents": docs})
		}

		// 2. AI Service Call (Slow)
		var aiOut struct {
			Graph       map[string]any   `json:"graph"`
			Decisions   []map[string]any `json:"decisions"`
			ReviewItems []map[string]any `json:"review_items"`
		}
		err = PostJSON(c.Request.Context(), "/v1/evaluate", map[string]any{
			"tender_id": tenderID,
			"criteria":  criteria,
			"bidders":   biddersPayload,
		}, &aiOut)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": fmt.Sprintf("AI Service error: %v", err)})
			return
		}

		// 3. Atomic DB Updates
		tx, err := db.BeginTx(c.Request.Context(), nil)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to start transaction"})
			return
		}
		defer tx.Rollback()

		// Clear old results
		if _, err := tx.ExecContext(c.Request.Context(), `DELETE FROM decisions WHERE tender_id=$1`, tenderID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to clear old decisions"})
			return
		}
		if _, err := tx.ExecContext(c.Request.Context(), `DELETE FROM evaluations WHERE tender_id=$1`, tenderID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to clear old evaluations"})
			return
		}
		if _, err := tx.ExecContext(c.Request.Context(), `DELETE FROM review_queue WHERE tender_id=$1`, tenderID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to clear old review items"})
			return
		}

		// Insert new decisions
		for _, d := range aiOut.Decisions {
			bid, _ := d["bidder_id"].(string)
			crid, _ := d["criterion_id"].(string)
			payload, _ := json.Marshal(d)
			sum := ChecksumJSON(json.RawMessage(payload))
			_, err = tx.ExecContext(c.Request.Context(),
				`INSERT INTO decisions (id, tender_id, bidder_id, criterion_id, payload, checksum) VALUES ($1,$2,$3::uuid,$4,$5::jsonb,$6)`,
				uuid.NewString(), tenderID, bid, crid, string(payload), sum)
			if err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save decision"})
				return
			}
		}

		// Update evaluation status
		graphJSON, _ := json.Marshal(aiOut.Graph)
		eid := uuid.NewString()
		_, err = tx.ExecContext(c.Request.Context(),
			`INSERT INTO evaluations (id, tender_id, status, graph) VALUES ($1,$2,'complete',$3::jsonb)`,
			eid, tenderID, string(graphJSON))
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save evaluation"})
			return
		}

		// Update review queue
		for _, r := range aiOut.ReviewItems {
			p, _ := json.Marshal(r)
			bid, _ := r["bidder_id"].(string)
			crid, _ := r["criterion_id"].(string)
			if _, err := tx.ExecContext(c.Request.Context(),
				`INSERT INTO review_queue (id, tender_id, bidder_id, criterion_id, status, payload) VALUES ($1,$2::uuid,$3::uuid,$4,'open',$5::jsonb)`,
				uuid.NewString(), tenderID, bid, crid, string(p)); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to save review item"})
				return
			}
		}

		if err := tx.Commit(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to commit changes"})
			return
		}

		WriteAudit(db, userID, tenderID, "evaluation.completed", map[string]any{"decisions": len(aiOut.Decisions)})
		c.JSON(http.StatusOK, gin.H{"evaluation_id": eid, "decisions": len(aiOut.Decisions), "graph": aiOut.Graph})
	}
}

func GetResults(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		tenderID := c.Param("id")
		if !RequireTenderOwner(db, c, tenderID) {
			return
		}
		var graph []byte
		_ = db.QueryRow(`SELECT graph FROM evaluations WHERE tender_id=$1 ORDER BY updated_at DESC LIMIT 1`, tenderID).Scan(&graph)

		rows, err := db.Query(`SELECT payload FROM decisions WHERE tender_id=$1`, tenderID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		defer rows.Close()
		decisions := make([]json.RawMessage, 0)
		for rows.Next() {
			var p []byte
			if err := rows.Scan(&p); err != nil {
				continue
			}
			decisions = append(decisions, p)
		}
		if err := rows.Err(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		var g any
		if len(graph) > 0 {
			json.Unmarshal(graph, &g)
		}
		c.JSON(http.StatusOK, gin.H{"tender_id": tenderID, "decisions": decisions, "graph": g})
	}
}

func GetBidderBreakdown(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		tenderID := c.Param("id")
		if !RequireTenderOwner(db, c, tenderID) {
			return
		}
		bid := c.Param("bid")
		rows, err := db.Query(`SELECT payload FROM decisions WHERE tender_id=$1 AND bidder_id=$2`, tenderID, bid)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		defer rows.Close()
		out := make([]json.RawMessage, 0)
		for rows.Next() {
			var p []byte
			if err := rows.Scan(&p); err != nil {
				continue
			}
			out = append(out, p)
		}
		if err := rows.Err(); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"bidder_id": bid, "decisions": out})
	}
}
