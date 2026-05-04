package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"runtime/debug"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/tendersense/backend/internal/service"
	"github.com/tendersense/backend/internal/util"
)

// Job statuses persisted in evaluation_jobs.status.
const (
	jobStatusQueued      = "queued"
	jobStatusRunning     = "running"
	jobStatusCompleted   = "completed"
	jobStatusFailed      = "failed"
	jobStatusInterrupted = "interrupted"
)

// Coarse-grained progress markers; the engine itself doesn't stream so these
// are the only checkpoints we know about.
const (
	progressQueued   = 0
	progressRunning  = 25
	progressFinished = 100
)

// evalJobRow is the shape returned by GET /tenders/:id/evaluate/jobs/:job.
type evalJobRow struct {
	ID        string          `json:"id"`
	TenderID  string          `json:"tender_id"`
	UserID    string          `json:"user_id,omitempty"`
	Status    string          `json:"status"`
	Progress  int             `json:"progress"`
	Error     string          `json:"error,omitempty"`
	Result    json.RawMessage `json:"result,omitempty"`
	CreatedAt time.Time       `json:"created_at"`
	UpdatedAt time.Time       `json:"updated_at"`
}

// TriggerEvaluation kicks off an async evaluation and returns the job id.
// Concurrency is gated by a partial unique index on (tender_id) where status
// is queued/running so duplicate triggers across processes are rejected by the DB.
func TriggerEvaluation(svc service.TenderService, db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		tenderID := c.Param("id")
		if !RequireTenderOwner(db, c, tenderID) {
			return
		}
		uid := c.GetString("user_id")

		jobID := uuid.NewString()
		_, err := db.ExecContext(c.Request.Context(),
			`INSERT INTO evaluation_jobs (id, tender_id, user_id, status, progress) VALUES ($1,$2,$3,$4,$5)`,
			jobID, tenderID, uid, jobStatusQueued, progressQueued)
		if err != nil {
			// Most likely cause: another job already queued/running for this tender (partial unique index).
			if isUniqueViolation(err) {
				existing, lookupErr := lookupActiveJob(c.Request.Context(), db, tenderID)
				if lookupErr == nil && existing != nil {
					c.JSON(http.StatusAccepted, gin.H{
						"job_id":    existing.ID,
						"status":    existing.Status,
						"tender_id": tenderID,
					})
					return
				}
				util.Conflict(c, "an evaluation is already in progress for this tender")
				return
			}
			util.InternalError(c, "failed to enqueue evaluation job")
			return
		}

		go runEvaluationJob(svc, db, jobID, tenderID, uid)

		c.JSON(http.StatusAccepted, gin.H{
			"job_id":    jobID,
			"status":    jobStatusQueued,
			"tender_id": tenderID,
		})
	}
}

// runEvaluationJob owns the lifecycle of a single eval job. It persists status
// transitions and the final result (or error) to evaluation_jobs.
func runEvaluationJob(svc service.TenderService, db *sql.DB, jobID, tenderID, userID string) {
	// Detached context: the HTTP handler returned long before this fires.
	ctx, cancel := context.WithTimeout(context.Background(), 17*time.Minute)
	defer cancel()

	defer func() {
		if r := recover(); r != nil {
			log.Printf(`{"event":"eval_job_panic","job_id":%q,"tender_id":%q,"panic":%q,"stack":%q}`,
				jobID, tenderID, fmt.Sprint(r), string(debug.Stack()))
			if _, err := db.ExecContext(context.Background(),
				`UPDATE evaluation_jobs SET status=$1, error=$2, updated_at=now() WHERE id=$3`,
				jobStatusFailed, "internal error during evaluation", jobID); err != nil {
				log.Printf(`{"event":"eval_job_update_failed","job_id":%q,"stage":"panic","err":%q}`, jobID, err.Error())
			}
		}
	}()

	if _, err := db.ExecContext(ctx,
		`UPDATE evaluation_jobs SET status=$1, progress=$2, updated_at=now() WHERE id=$3`,
		jobStatusRunning, progressRunning, jobID); err != nil {
		log.Printf(`{"event":"eval_job_update_failed","job_id":%q,"stage":"running","err":%q}`, jobID, err.Error())
	}

	res, err := svc.TriggerEvaluation(ctx, tenderID)
	if err != nil {
		if _, uerr := db.ExecContext(ctx,
			`UPDATE evaluation_jobs SET status=$1, error=$2, updated_at=now() WHERE id=$3`,
			jobStatusFailed, err.Error(), jobID); uerr != nil {
			log.Printf(`{"event":"eval_job_update_failed","job_id":%q,"stage":"failed","err":%q}`, jobID, uerr.Error())
		}
		log.Printf(`{"event":"evaluation_async_failed","job_id":%q,"tender_id":%q,"error":%q}`, jobID, tenderID, err.Error())
		return
	}

	payload, _ := json.Marshal(res)
	if _, err := db.ExecContext(ctx,
		`UPDATE evaluation_jobs SET status=$1, progress=$2, payload=$3::jsonb, error=NULL, updated_at=now() WHERE id=$4`,
		jobStatusCompleted, progressFinished, string(payload), jobID); err != nil {
		log.Printf(`{"event":"eval_job_update_failed","job_id":%q,"stage":"completed","err":%q}`, jobID, err.Error())
	}
	WriteAudit(db, userID, tenderID, "evaluation.completed", map[string]any{"decisions": res.Decisions, "job_id": jobID})
}

// GetEvaluationJobStatus reads the persisted job row.
func GetEvaluationJobStatus(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		tenderID := c.Param("id")
		if !RequireTenderOwner(db, c, tenderID) {
			return
		}
		jobID := c.Param("job")
		row, err := loadJob(c.Request.Context(), db, jobID)
		if errors.Is(err, sql.ErrNoRows) || (row != nil && row.TenderID != tenderID) {
			util.NotFound(c, "job not found")
			return
		}
		if err != nil {
			util.InternalError(c, "failed to load job")
			return
		}
		// Always 200 so clients can parse JSON reliably (polling must not treat failed jobs as transport errors).
		c.JSON(http.StatusOK, row)
	}
}

func loadJob(ctx context.Context, db *sql.DB, jobID string) (*evalJobRow, error) {
	var (
		row       evalJobRow
		userID    sql.NullString
		errCol    sql.NullString
		payload   []byte
	)
	err := db.QueryRowContext(ctx,
		`SELECT id, tender_id, COALESCE(user_id,''), status, progress, COALESCE(error,''), payload, created_at, updated_at
		 FROM evaluation_jobs WHERE id=$1`, jobID).
		Scan(&row.ID, &row.TenderID, &userID, &row.Status, &row.Progress, &errCol, &payload, &row.CreatedAt, &row.UpdatedAt)
	if err != nil {
		return nil, err
	}
	row.UserID = userID.String
	row.Error = errCol.String
	if len(payload) > 0 {
		row.Result = json.RawMessage(payload)
	}
	return &row, nil
}

func lookupActiveJob(ctx context.Context, db *sql.DB, tenderID string) (*evalJobRow, error) {
	var (
		row     evalJobRow
		userID  sql.NullString
		errCol  sql.NullString
		payload []byte
	)
	err := db.QueryRowContext(ctx,
		`SELECT id, tender_id, COALESCE(user_id,''), status, progress, COALESCE(error,''), payload, created_at, updated_at
		 FROM evaluation_jobs
		 WHERE tender_id=$1 AND status IN ('queued','running')
		 ORDER BY created_at DESC
		 LIMIT 1`, tenderID).
		Scan(&row.ID, &row.TenderID, &userID, &row.Status, &row.Progress, &errCol, &payload, &row.CreatedAt, &row.UpdatedAt)
	if err != nil {
		return nil, err
	}
	row.UserID = userID.String
	row.Error = errCol.String
	if len(payload) > 0 {
		row.Result = json.RawMessage(payload)
	}
	return &row, nil
}

// isUniqueViolation matches the pq error code (23505) without taking a hard
// dependency on lib/pq types in this package.
func isUniqueViolation(err error) bool {
	if err == nil {
		return false
	}
	msg := err.Error()
	if strings.Contains(msg, "23505") {
		return true
	}
	// covers sqlmock + sqlite/text-mode drivers used in tests
	lower := strings.ToLower(msg)
	return strings.Contains(lower, "unique constraint") || strings.Contains(lower, "duplicate key")
}

// GetResults returns the latest evaluation graph + decisions snapshot.
// Decisions are always paginated (?limit / ?offset, same caps as util.ParsePagination, max 200).
func GetResults(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		tenderID := c.Param("id")
		if !RequireTenderOwner(db, c, tenderID) {
			return
		}
		page, perr := util.ParsePagination(c)
		if perr != nil {
			util.BadRequest(c, perr.Error())
			return
		}
		var graph []byte
		_ = db.QueryRow(`SELECT graph FROM evaluations WHERE tender_id=$1 ORDER BY updated_at DESC LIMIT 1`, tenderID).Scan(&graph)

		var totalCount int
		if err := db.QueryRow(`SELECT COUNT(*) FROM decisions WHERE tender_id=$1`, tenderID).Scan(&totalCount); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				totalCount = 0
			} else {
				util.InternalError(c, err.Error())
				return
			}
		}
		rows, err := db.Query(
			`SELECT payload FROM decisions WHERE tender_id=$1 ORDER BY created_at ASC LIMIT $2 OFFSET $3`,
			tenderID, page.Limit, page.Offset,
		)
		if err != nil {
			util.InternalError(c, err.Error())
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
		if err := rows.Err(); err != nil && !errors.Is(err, sql.ErrNoRows) {
			util.InternalError(c, err.Error())
			return
		}
		var g any
		if len(graph) > 0 {
			json.Unmarshal(graph, &g)
		}
		state := "complete"
		if totalCount == 0 {
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
		util.SetTotalCountHeader(c, totalCount)
		c.JSON(http.StatusOK, gin.H{
			"tender_id":   tenderID,
			"decisions":   decisions,
			"graph":       g,
			"state":       state,
			"pagination": gin.H{"total": totalCount, "limit": page.Limit, "offset": page.Offset},
		})
	}
}

func GetBidderBreakdown(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		tenderID := c.Param("id")
		if !RequireTenderOwner(db, c, tenderID) {
			return
		}
		bid := c.Param("bid")
		page, perr := util.ParsePagination(c)
		if perr != nil {
			util.BadRequest(c, perr.Error())
			return
		}
		var total int
		if err := db.QueryRow(
			`SELECT COUNT(*) FROM decisions WHERE tender_id=$1 AND bidder_id=$2`,
			tenderID, bid,
		).Scan(&total); err != nil {
			if errors.Is(err, sql.ErrNoRows) {
				total = 0
			} else {
				util.InternalError(c, err.Error())
				return
			}
		}
		rows, err := db.Query(
			`SELECT payload FROM decisions WHERE tender_id=$1 AND bidder_id=$2 ORDER BY created_at ASC LIMIT $3 OFFSET $4`,
			tenderID, bid, page.Limit, page.Offset,
		)
		if err != nil {
			util.InternalError(c, err.Error())
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
		if err := rows.Err(); err != nil && !errors.Is(err, sql.ErrNoRows) {
			util.InternalError(c, err.Error())
			return
		}
		util.SetTotalCountHeader(c, total)
		c.JSON(http.StatusOK, gin.H{
			"bidder_id":   bid,
			"decisions":   out,
			"pagination": gin.H{"total": total, "limit": page.Limit, "offset": page.Offset},
		})
	}
}
