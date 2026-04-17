package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func TriggerEvaluation(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		tenderID := c.Param("id")
		uid := c.GetString("user_id")

		crows, err := db.Query(`SELECT id, payload FROM criteria WHERE tender_id=$1`, tenderID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		var criteria []map[string]any
		for crows.Next() {
			var id string
			var payload []byte
			crows.Scan(&id, &payload)
			var m map[string]any
			json.Unmarshal(payload, &m)
			m["id"] = id
			criteria = append(criteria, m)
		}
		crows.Close()
		if len(criteria) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "no criteria — upload tender document first"})
			return
		}

		brows, err := db.Query(`SELECT id FROM bidders WHERE tender_id=$1`, tenderID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		var bidderIDs []string
		for brows.Next() {
			var id string
			brows.Scan(&id)
			bidderIDs = append(bidderIDs, id)
		}
		brows.Close()
		if len(bidderIDs) == 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "no bidders"})
			return
		}

		type docRow struct {
			ID       string
			Filename string
			DocType  string
			OCR      []byte
		}
		biddersPayload := []map[string]any{}
		for _, bid := range bidderIDs {
			drows, _ := db.Query(`SELECT id, filename, doc_type, ocr_payload FROM documents WHERE owner_type='bidder' AND owner_id=$1`, bid)
			var docs []map[string]any
			for drows.Next() {
				var dr docRow
				drows.Scan(&dr.ID, &dr.Filename, &dr.DocType, &dr.OCR)
				var ocr map[string]any
				if len(dr.OCR) > 0 {
					json.Unmarshal(dr.OCR, &ocr)
				}
				docs = append(docs, map[string]any{
					"id": dr.ID, "filename": dr.Filename, "doc_type": dr.DocType, "ocr": ocr,
				})
			}
			drows.Close()
			biddersPayload = append(biddersPayload, map[string]any{"bidder_id": bid, "documents": docs})
		}

		var aiOut struct {
			Graph      map[string]any   `json:"graph"`
			Decisions  []map[string]any `json:"decisions"`
			ReviewItems []map[string]any `json:"review_items"`
		}
		err = PostJSON("/v1/evaluate", map[string]any{
			"tender_id": tenderID,
			"criteria":  criteria,
			"bidders":   biddersPayload,
		}, &aiOut)
		if err != nil {
			c.JSON(http.StatusBadGateway, gin.H{"error": err.Error()})
			return
		}

		db.Exec(`DELETE FROM decisions WHERE tender_id=$1`, tenderID)
		for _, d := range aiOut.Decisions {
			did := uuid.NewString()
			bid, _ := d["bidder_id"].(string)
			crid, _ := d["criterion_id"].(string)
			payload, _ := json.Marshal(d)
			sum := ChecksumJSON(json.RawMessage(payload))
			db.Exec(`INSERT INTO decisions (id, tender_id, bidder_id, criterion_id, payload, checksum) VALUES ($1,$2,$3::uuid,$4,$5::jsonb,$6)`,
				did, tenderID, bid, crid, string(payload), sum)
		}

		graphJSON, _ := json.Marshal(aiOut.Graph)
		db.Exec(`DELETE FROM evaluations WHERE tender_id=$1`, tenderID)
		eid := uuid.NewString()
		db.Exec(`INSERT INTO evaluations (id, tender_id, status, graph) VALUES ($1,$2,'complete',$3::jsonb)`, eid, tenderID, string(graphJSON))

		db.Exec(`DELETE FROM review_queue WHERE tender_id=$1`, tenderID)
		for _, r := range aiOut.ReviewItems {
			rid := uuid.NewString()
			p, _ := json.Marshal(r)
			bid, _ := r["bidder_id"].(string)
			crid, _ := r["criterion_id"].(string)
			db.Exec(`INSERT INTO review_queue (id, tender_id, bidder_id, criterion_id, status, payload) VALUES ($1,$2::uuid,$3::uuid,$4,'open',$5::jsonb)`,
				rid, tenderID, bid, crid, string(p))
		}

		WriteAudit(db, uid, tenderID, "evaluation.completed", map[string]any{"decisions": len(aiOut.Decisions)})
		c.JSON(http.StatusOK, gin.H{"evaluation_id": eid, "decisions": len(aiOut.Decisions), "graph": aiOut.Graph})
	}
}

func GetResults(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		tenderID := c.Param("id")
		var graph []byte
		_ = db.QueryRow(`SELECT graph FROM evaluations WHERE tender_id=$1 ORDER BY updated_at DESC LIMIT 1`, tenderID).Scan(&graph)

		rows, err := db.Query(`SELECT payload FROM decisions WHERE tender_id=$1`, tenderID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		defer rows.Close()
		var decisions []json.RawMessage
		for rows.Next() {
			var p []byte
			rows.Scan(&p)
			decisions = append(decisions, p)
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
		bid := c.Param("bid")
		rows, err := db.Query(`SELECT payload FROM decisions WHERE tender_id=$1 AND bidder_id=$2`, tenderID, bid)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		defer rows.Close()
		var out []json.RawMessage
		for rows.Next() {
			var p []byte
			rows.Scan(&p)
			out = append(out, p)
		}
		c.JSON(http.StatusOK, gin.H{"bidder_id": bid, "decisions": out})
	}
}
