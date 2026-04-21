package handlers

import (
	"database/sql"
	"encoding/json"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/tendersense/backend/internal/service"
)

func TriggerEvaluation(svc service.TenderService, db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		tenderID := c.Param("id")
		if !RequireTenderOwner(db, c, tenderID) {
			return
		}
		uid, _ := c.Get("user_id")
		userID, _ := uid.(string)

		res, err := svc.TriggerEvaluation(c.Request.Context(), tenderID)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		WriteAudit(db, userID, tenderID, "evaluation.completed", map[string]any{"decisions": res.Decisions})
		c.JSON(http.StatusOK, res)
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
