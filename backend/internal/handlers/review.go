package handlers

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/tendersense/backend/internal/util"
	"github.com/tendersense/backend/internal/util/pii"
)

var allowedOverrideVerdicts = map[string]struct{}{
	"ELIGIBLE": {}, "NOT_ELIGIBLE": {}, "NEEDS_REVIEW": {},
}

func ReviewQueue(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		uid := c.GetString("user_id")
		admin := strings.EqualFold(strings.TrimSpace(c.GetString("role")), "admin")
		page, err := util.ParsePagination(c)
		if err != nil {
			util.BadRequest(c, err.Error())
			return
		}
		var total int
		if admin {
			if err := db.QueryRow(`
				SELECT COUNT(*)
				FROM review_queue rq
				WHERE rq.status='open'`).Scan(&total); err != nil {
				util.InternalError(c, err.Error())
				return
			}
		} else {
			if err := db.QueryRow(`
				SELECT COUNT(*)
				FROM review_queue rq
				JOIN tenders t ON rq.tender_id = t.id
				WHERE rq.status='open' AND t.owner_id=$1`, uid).Scan(&total); err != nil {
				util.InternalError(c, err.Error())
				return
			}
		}
		var rows *sql.Rows
		if admin {
			rows, err = db.Query(`
				SELECT rq.id, rq.tender_id, rq.bidder_id, rq.criterion_id, rq.payload, rq.created_at, t.title, b.name
				FROM review_queue rq
				JOIN tenders t ON rq.tender_id = t.id
				JOIN bidders b ON rq.bidder_id = b.id
				WHERE rq.status='open'
				ORDER BY rq.created_at
				LIMIT $1 OFFSET $2`, page.Limit, page.Offset)
		} else {
			rows, err = db.Query(`
				SELECT rq.id, rq.tender_id, rq.bidder_id, rq.criterion_id, rq.payload, rq.created_at, t.title, b.name
				FROM review_queue rq
				JOIN tenders t ON rq.tender_id = t.id
				JOIN bidders b ON rq.bidder_id = b.id
				WHERE rq.status='open' AND t.owner_id=$1
				ORDER BY rq.created_at
				LIMIT $2 OFFSET $3`, uid, page.Limit, page.Offset)
		}
		if err != nil {
			util.InternalError(c, err.Error())
			return
		}
		defer rows.Close()
		items := make([]map[string]any, 0)
		for rows.Next() {
			var id, tid, bid, cid string
			var payload []byte
			var created interface{}
			var tenderTitle, bidderName string
			if err := rows.Scan(&id, &tid, &bid, &cid, &payload, &created, &tenderTitle, &bidderName); err != nil {
				continue
			}
			var p map[string]any
			_ = json.Unmarshal(payload, &p)
			items = append(items, map[string]any{
				"id": id, "tender_id": tid, "bidder_id": bid, "criterion_id": cid,
				"tender_title": tenderTitle, "bidder_name": bidderName,
				"payload": p, "created_at": created,
			})
		}
		if err := rows.Err(); err != nil {
			util.InternalError(c, err.Error())
			return
		}
		util.SetTotalCountHeader(c, total)
		c.JSON(http.StatusOK, gin.H{"items": items})
	}
}

type overrideReq struct {
	TenderID      string `json:"tender_id" binding:"required"`
	BidderID      string `json:"bidder_id" binding:"required"`
	CriterionID   string `json:"criterion_id" binding:"required"`
	NewVerdict    string `json:"new_verdict" binding:"required"`
	Justification string `json:"justification" binding:"required,min=10,max=4000"`
}

func SubmitOverride(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req overrideReq
		if err := c.ShouldBindJSON(&req); err != nil {
			util.BadRequest(c, err.Error())
			return
		}
		uid := c.GetString("user_id")
		if !RequireTenderOwner(db, c, req.TenderID) {
			return
		}
		nv := strings.ToUpper(strings.TrimSpace(req.NewVerdict))
		if _, ok := allowedOverrideVerdicts[nv]; !ok {
			util.BadRequest(c, "invalid new_verdict")
			return
		}

		tx, err := db.BeginTx(c.Request.Context(), nil)
		if err != nil {
			util.InternalError(c, "transaction failed")
			return
		}
		defer tx.Rollback()

		var oldPayload []byte
		err = tx.QueryRowContext(c.Request.Context(),
			`SELECT payload FROM decisions WHERE tender_id=$1 AND bidder_id=$2 AND criterion_id=$3`,
			req.TenderID, req.BidderID, req.CriterionID,
		).Scan(&oldPayload)
		if errors.Is(err, sql.ErrNoRows) {
			util.NotFound(c, "decision not found")
			return
		}
		if err != nil {
			util.InternalError(c, err.Error())
			return
		}
		var m map[string]any
		if err := json.Unmarshal(oldPayload, &m); err != nil {
			util.InternalError(c, "invalid decision payload")
			return
		}
		m["verdict"] = nv
		m["reviewer_override"] = req.Justification
		m["override_by"] = uid
		newB, _ := json.Marshal(m)
		sum := util.ChecksumJSON(json.RawMessage(newB))
		if _, err := tx.ExecContext(c.Request.Context(),
			`UPDATE decisions SET payload=$4::jsonb, checksum=$5 WHERE tender_id=$1 AND bidder_id=$2 AND criterion_id=$3`,
			req.TenderID, req.BidderID, req.CriterionID, string(newB), sum); err != nil {
			util.InternalError(c, "failed to update decision")
			return
		}
		if _, err := tx.ExecContext(c.Request.Context(),
			`UPDATE review_queue SET status='resolved' WHERE tender_id=$1 AND bidder_id=$2 AND criterion_id=$3`,
			req.TenderID, req.BidderID, req.CriterionID); err != nil {
			util.InternalError(c, "failed to resolve review item")
			return
		}

		audit := map[string]any{
			"tender_id": req.TenderID, "bidder_id": req.BidderID, "criterion_id": req.CriterionID,
			"new_verdict": nv, "justification": req.Justification,
		}
		ab, _ := json.Marshal(audit)
		// Officer-typed justification text is the highest-risk leak surface
		// in the audit log — strip PAN/Aadhaar/GSTIN before persistence.
		ab = pii.RedactJSON(ab)
		ch := util.ChecksumJSON(json.RawMessage(ab))
		if _, err := tx.ExecContext(c.Request.Context(),
			`INSERT INTO audit_log (tender_id, user_id, action, payload, checksum) VALUES ($1::uuid,$2::uuid,$3,$4::jsonb,$5)`,
			req.TenderID, uid, "reviewer.override", string(ab), ch); err != nil {
			util.InternalError(c, "failed to write audit")
			return
		}
		if err := tx.Commit(); err != nil {
			util.InternalError(c, "commit failed")
			return
		}

		c.JSON(http.StatusOK, gin.H{"ok": true})
	}
}

func AuditLog(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		uid := c.GetString("user_id")
		tenderID := c.Query("tender_id")
		page, perr := util.ParsePagination(c)
		if perr != nil {
			util.BadRequest(c, perr.Error())
			return
		}
		q := `SELECT id, tender_id, user_id, action, payload, checksum, created_at FROM audit_log`
		var (
			rows  *sql.Rows
			err   error
			total int
		)
		if tenderID != "" {
			if !RequireTenderOwner(db, c, tenderID) {
				return
			}
			if err := db.QueryRow(`SELECT COUNT(*) FROM audit_log WHERE tender_id=$1::uuid`, tenderID).Scan(&total); err != nil {
				util.InternalError(c, err.Error())
				return
			}
			rows, err = db.Query(q+` WHERE tender_id=$1::uuid ORDER BY id DESC LIMIT $2 OFFSET $3`, tenderID, page.Limit, page.Offset)
		} else {
			if err := db.QueryRow(`SELECT COUNT(*) FROM audit_log WHERE (
				(tender_id IS NOT NULL AND tender_id IN (SELECT id FROM tenders WHERE owner_id=$1::uuid))
				OR (user_id IS NOT NULL AND user_id=$1::uuid)
			)`, uid).Scan(&total); err != nil {
				util.InternalError(c, err.Error())
				return
			}
			rows, err = db.Query(q+` WHERE (
				(tender_id IS NOT NULL AND tender_id IN (SELECT id FROM tenders WHERE owner_id=$1::uuid))
				OR (user_id IS NOT NULL AND user_id=$1::uuid)
			) ORDER BY id DESC LIMIT $2 OFFSET $3`, uid, page.Limit, page.Offset)
		}
		if err != nil {
			util.InternalError(c, err.Error())
			return
		}
		defer rows.Close()
		items := make([]map[string]any, 0)
		for rows.Next() {
			var id int64
			var tid, rowUID, action, sum sql.NullString
			var payload []byte
			var created interface{}
			if err := rows.Scan(&id, &tid, &rowUID, &action, &payload, &sum, &created); err != nil {
				continue
			}
			var p any
			_ = json.Unmarshal(payload, &p)
			items = append(items, map[string]any{
				"id": id, "tender_id": tid.String, "user_id": rowUID.String, "action": action.String,
				"payload": p, "checksum": sum.String, "created_at": created,
			})
		}
		if err := rows.Err(); err != nil {
			util.InternalError(c, err.Error())
			return
		}
		util.SetTotalCountHeader(c, total)
		c.JSON(http.StatusOK, gin.H{"entries": items})
	}
}

func DecisionEvidence(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		tenderID := c.Param("id")
		if !RequireTenderOwner(db, c, tenderID) {
			return
		}
		bid := c.Param("bid")
		crit := c.Param("crit")
		var payload []byte
		err := db.QueryRow(
			`SELECT payload FROM decisions WHERE tender_id=$1 AND bidder_id=$2 AND criterion_id=$3`,
			tenderID, bid, crit,
		).Scan(&payload)
		if errors.Is(err, sql.ErrNoRows) {
			util.NotFound(c, "not found")
			return
		}
		if err != nil {
			util.InternalError(c, err.Error())
			return
		}
		var m map[string]any
		json.Unmarshal(payload, &m)
		c.JSON(http.StatusOK, m)
	}
}
