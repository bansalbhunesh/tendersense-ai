package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
)

func ReviewQueue(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		uid := c.GetString("user_id")
		rows, err := db.Query(`
			SELECT rq.id, rq.tender_id, rq.bidder_id, rq.criterion_id, rq.payload, rq.created_at 
			FROM review_queue rq
			JOIN tenders t ON rq.tender_id = t.id
			WHERE rq.status='open' AND t.owner_id=$1
			ORDER BY rq.created_at`, uid)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		defer rows.Close()
		var items []map[string]any
		for rows.Next() {
			var id, tid, bid, cid string
			var payload []byte
			var created interface{}
			rows.Scan(&id, &tid, &bid, &cid, &payload, &created)
			var p map[string]any
			json.Unmarshal(payload, &p)
			items = append(items, map[string]any{
				"id": id, "tender_id": tid, "bidder_id": bid, "criterion_id": cid, "payload": p, "created_at": created,
			})
		}
		c.JSON(http.StatusOK, gin.H{"items": items})
	}
}

type overrideReq struct {
	TenderID     string `json:"tender_id" binding:"required"`
	BidderID     string `json:"bidder_id" binding:"required"`
	CriterionID  string `json:"criterion_id" binding:"required"`
	NewVerdict   string `json:"new_verdict" binding:"required"`
	Justification string `json:"justification" binding:"required"`
}

func SubmitOverride(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req overrideReq
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		uid := c.GetString("user_id")

		var oldPayload []byte
		err := db.QueryRow(
			`SELECT payload FROM decisions WHERE tender_id=$1 AND bidder_id=$2 AND criterion_id=$3`,
			req.TenderID, req.BidderID, req.CriterionID,
		).Scan(&oldPayload)
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "decision not found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		var m map[string]any
		json.Unmarshal(oldPayload, &m)
		m["verdict"] = req.NewVerdict
		m["reviewer_override"] = req.Justification
		m["override_by"] = uid
		newB, _ := json.Marshal(m)
		sum := ChecksumJSON(json.RawMessage(newB))
		if _, err := db.Exec(`UPDATE decisions SET payload=$4::jsonb, checksum=$5 WHERE tender_id=$1 AND bidder_id=$2 AND criterion_id=$3`,
			req.TenderID, req.BidderID, req.CriterionID, string(newB), sum); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to update decision"})
			return
		}
		if _, err := db.Exec(`UPDATE review_queue SET status='resolved' WHERE tender_id=$1 AND bidder_id=$2 AND criterion_id=$3`,
			req.TenderID, req.BidderID, req.CriterionID); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "failed to resolve review item"})
			return
		}

		audit := map[string]any{
			"tender_id": req.TenderID, "bidder_id": req.BidderID, "criterion_id": req.CriterionID,
			"new_verdict": req.NewVerdict, "justification": req.Justification,
		}
		ab, _ := json.Marshal(audit)
		ch := ChecksumJSON(audit)
		db.Exec(`INSERT INTO audit_log (tender_id, user_id, action, payload, checksum) VALUES ($1::uuid,$2::uuid,$3,$4::jsonb,$5)`,
			req.TenderID, uid, "reviewer.override", string(ab), ch)

		c.JSON(http.StatusOK, gin.H{"ok": true})
	}
}

func AuditLog(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		tenderID := c.Query("tender_id")
		q := `SELECT id, tender_id, user_id, action, payload, checksum, created_at FROM audit_log`
		var rows *sql.Rows
		var err error
		if tenderID != "" {
			rows, err = db.Query(q+` WHERE tender_id=$1::uuid ORDER BY id DESC LIMIT 200`, tenderID)
		} else {
			rows, err = db.Query(q + ` ORDER BY id DESC LIMIT 200`)
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		defer rows.Close()
		var items []map[string]any
		for rows.Next() {
			var id int64
			var tid, uid, action, sum sql.NullString
			var payload []byte
			var created interface{}
			rows.Scan(&id, &tid, &uid, &action, &payload, &sum, &created)
			var p any
			json.Unmarshal(payload, &p)
			items = append(items, map[string]any{
				"id": id, "tender_id": tid.String, "user_id": uid.String, "action": action.String,
				"payload": p, "checksum": sum.String, "created_at": created,
			})
		}
		c.JSON(http.StatusOK, gin.H{"entries": items})
	}
}

func DecisionEvidence(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		tenderID := c.Param("id")
		bid := c.Param("bid")
		crit := c.Param("crit")
		var payload []byte
		err := db.QueryRow(
			`SELECT payload FROM decisions WHERE tender_id=$1 AND bidder_id=$2 AND criterion_id=$3`,
			tenderID, bid, crit,
		).Scan(&payload)
		if err == sql.ErrNoRows {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		var m map[string]any
		json.Unmarshal(payload, &m)
		c.JSON(http.StatusOK, m)
	}
}
