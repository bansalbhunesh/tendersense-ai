package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/tendersense/backend/internal/service"
)

type evalJob struct {
	ID        string     `json:"id"`
	TenderID  string     `json:"tender_id"`
	UserID    string     `json:"user_id"`
	Status    string     `json:"status"`
	Error     string     `json:"error,omitempty"`
	Result    any        `json:"result,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
	UpdatedAt time.Time  `json:"updated_at"`
	StartedAt *time.Time `json:"started_at,omitempty"`
	EndedAt   *time.Time `json:"ended_at,omitempty"`
}

var (
	evalJobsMu sync.Mutex
	evalJobs   = map[string]*evalJob{}
	evalActive = map[string]string{}
)

func TriggerEvaluation(svc service.TenderService, db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		tenderID := c.Param("id")
		if !RequireTenderOwner(db, c, tenderID) {
			return
		}
		uid, _ := c.Get("user_id")
		userID, _ := uid.(string)
		jobID := uuid.NewString()
		now := time.Now()
		key := userID + ":" + tenderID
		evalJobsMu.Lock()
		if existingID, ok := evalActive[key]; ok {
			if existingJob, exists := evalJobs[existingID]; exists && (existingJob.Status == "queued" || existingJob.Status == "running") {
				evalJobsMu.Unlock()
				c.JSON(http.StatusAccepted, gin.H{
					"job_id":    existingJob.ID,
					"status":    existingJob.Status,
					"tender_id": tenderID,
				})
				return
			}
		}
		job := &evalJob{
			ID:        jobID,
			TenderID:  tenderID,
			UserID:    userID,
			Status:    "queued",
			CreatedAt: now,
			UpdatedAt: now,
		}
		evalJobs[jobID] = job
		evalActive[key] = jobID
		evalJobsMu.Unlock()

		go func() {
			// Never use c.Request.Context() here: Go cancels it when the HTTP handler returns,
			// which would abort the long-running evaluation immediately after 202 Accepted.
			ctx, cancel := context.WithTimeout(context.Background(), 17*time.Minute)
			defer cancel()

			started := time.Now()
			evalJobsMu.Lock()
			job.Status = "running"
			job.StartedAt = &started
			job.UpdatedAt = started
			evalJobsMu.Unlock()

			res, err := svc.TriggerEvaluation(ctx, tenderID)
			ended := time.Now()
			evalJobsMu.Lock()
			defer evalJobsMu.Unlock()
			job.UpdatedAt = ended
			job.EndedAt = &ended
			delete(evalActive, key)
			if err != nil {
				job.Status = "failed"
				job.Error = err.Error()
				log.Printf(`{"event":"evaluation_async_failed","job_id":"%s","tender_id":"%s","error":"%s"}`, jobID, tenderID, err.Error())
				return
			}
			job.Status = "completed"
			job.Result = res
			WriteAudit(db, userID, tenderID, "evaluation.completed", map[string]any{"decisions": res.Decisions, "job_id": jobID})
		}()

		c.JSON(http.StatusAccepted, gin.H{
			"job_id":    jobID,
			"status":    job.Status,
			"tender_id": tenderID,
		})
	}
}

func GetEvaluationJobStatus(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		tenderID := c.Param("id")
		if !RequireTenderOwner(db, c, tenderID) {
			return
		}
		jobID := c.Param("job")
		evalJobsMu.Lock()
		job, ok := evalJobs[jobID]
		evalJobsMu.Unlock()
		if !ok || job.TenderID != tenderID {
			c.JSON(http.StatusNotFound, gin.H{"error": "job not found"})
			return
		}
		// Always 200 so clients can parse JSON reliably (polling must not treat failed jobs as transport errors).
		c.JSON(http.StatusOK, job)
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
		state := "complete"
		if len(decisions) == 0 {
			var evalStatus string
			err = db.QueryRow(`SELECT status FROM evaluations WHERE tender_id=$1 ORDER BY updated_at DESC LIMIT 1`, tenderID).Scan(&evalStatus)
			if err == nil && evalStatus != "" {
				state = evalStatus
			} else if errors.Is(err, sql.ErrNoRows) {
				state = "none"
			} else if err != nil {
				state = "unknown"
			}
		}
		c.JSON(http.StatusOK, gin.H{"tender_id": tenderID, "decisions": decisions, "graph": g, "state": state})
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
