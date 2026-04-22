package service

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"

	"github.com/google/uuid"

	"github.com/tendersense/backend/internal/repository"
	"github.com/tendersense/backend/internal/util"
)

type TenderService interface {
	TriggerEvaluation(ctx context.Context, tenderID string) (*EvaluationResult, error)
}

type tenderService struct {
	repo repository.TenderRepository
}

type EvaluationResult struct {
	ID             string         `json:"evaluation_id"`
	Decisions      int            `json:"decisions"`
	DecisionsCount int            `json:"decisions_count"`
	Graph          map[string]any `json:"graph"`
}

type AIOutput struct {
	Graph       map[string]any   `json:"graph"`
	Decisions   []map[string]any `json:"decisions"`
	ReviewItems []map[string]any `json:"review_items"`
}

func NewTenderService(repo repository.TenderRepository) TenderService {
	return &tenderService{repo: repo}
}

func (s *tenderService) TriggerEvaluation(ctx context.Context, tenderID string) (*EvaluationResult, error) {
	// 1. Fetch criteria
	criteria, err := s.repo.GetCriteria(ctx, tenderID)
	if err != nil {
		return nil, fmt.Errorf("fetch criteria: %w", err)
	}
	if len(criteria) == 0 {
		return nil, fmt.Errorf("no criteria found for tender")
	}

	// 2. Fetch bidders and their documents
	bidderIDs, err := s.repo.GetBidderIDs(ctx, tenderID)
	if err != nil {
		return nil, fmt.Errorf("fetch bidder IDs: %w", err)
	}
	if len(bidderIDs) == 0 {
		return nil, fmt.Errorf("no bidders registered")
	}

	for i := range criteria {
		if criteria[i] == nil {
			continue
		}
		criteria[i]["id"] = fmt.Sprint(criteria[i]["id"])
	}

	biddersPayload := make([]map[string]any, 0, len(bidderIDs))
	for _, bid := range bidderIDs {
		docs, err := s.repo.GetBidderDocuments(ctx, bid)
		if err != nil {
			return nil, fmt.Errorf("fetch bidder documents (%s): %w", bid, err)
		}
		biddersPayload = append(biddersPayload, map[string]any{
			"bidder_id": bid,
			"documents": docs,
		})
	}

	// 3. AI Service Call (single long request — no stacked retries)
	var aiOut AIOutput
	err = util.PostEvaluateJSON(ctx, map[string]any{
		"tender_id": tenderID,
		"criteria":  criteria,
		"bidders":   biddersPayload,
	}, &aiOut)
	if err != nil {
		return nil, fmt.Errorf("ai service: %w", err)
	}

	// Pre-validate and sanitize AI output before starting transaction.
	validDecisions := make([]map[string]any, 0, len(aiOut.Decisions))
	for _, d := range aiOut.Decisions {
		bid, _ := d["bidder_id"].(string)
		if _, perr := uuid.Parse(bid); perr != nil {
			continue
		}
		crid, _ := d["criterion_id"].(string)
		if crid == "" {
			continue
		}
		validDecisions = append(validDecisions, d)
	}
	if len(validDecisions) == 0 {
		return nil, fmt.Errorf("evaluation returned no valid decisions")
	}
	validReviewItems := make([]map[string]any, 0, len(aiOut.ReviewItems))
	for _, r := range aiOut.ReviewItems {
		bid, _ := r["bidder_id"].(string)
		if _, perr := uuid.Parse(bid); perr != nil {
			continue
		}
		crid, _ := r["criterion_id"].(string)
		if crid == "" {
			continue
		}
		validReviewItems = append(validReviewItems, r)
	}

	// 4. Save results in Transaction
	eid := uuid.NewString()
	err = s.repo.WithTransaction(ctx, func(tx *sql.Tx) error {
		// Clear old results
		if err := s.repo.ClearTenderResults(ctx, tx, tenderID); err != nil {
			return err
		}

		// Save decisions (skip rows with invalid bidder UUIDs or empty criterion_id)
		for _, d := range validDecisions {
			payload, _ := json.Marshal(d)
			sum := util.ChecksumJSON(json.RawMessage(payload))
			if err := s.repo.SaveDecision(ctx, tx, d, tenderID, sum); err != nil {
				return err
			}
		}

		// Save evaluation
		graphJSON, _ := json.Marshal(aiOut.Graph)
		if err := s.repo.SaveEvaluation(ctx, tx, eid, tenderID, "complete", string(graphJSON)); err != nil {
			return err
		}

		for _, r := range validReviewItems {
			rid := uuid.NewString()
			if err := s.repo.SaveReviewItem(ctx, tx, rid, tenderID, r); err != nil {
				return err
			}
		}
		return nil
	})

	if err != nil {
		return nil, fmt.Errorf("db transaction: %w", err)
	}

	n := len(validDecisions)
	return &EvaluationResult{
		ID:             eid,
		Decisions:      n,
		DecisionsCount: n,
		Graph:          aiOut.Graph,
	}, nil
}
