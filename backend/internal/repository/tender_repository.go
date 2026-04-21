package repository

import (
	"context"
	"database/sql"
	"encoding/json"
)

type TenderRepository interface {
	GetCriteria(ctx context.Context, tenderID string) ([]map[string]any, error)
	GetBidderIDs(ctx context.Context, tenderID string) ([]string, error)
	GetBidderDocuments(ctx context.Context, bidderID string) ([]map[string]any, error)
	
	WithTransaction(ctx context.Context, fn func(*sql.Tx) error) error
	
	ClearTenderResults(ctx context.Context, tx *sql.Tx, tenderID string) error
	SaveDecision(ctx context.Context, tx *sql.Tx, d map[string]any, tenderID, checksum string) error
	SaveEvaluation(ctx context.Context, tx *sql.Tx, id, tenderID, status, graph string) error
	SaveReviewItem(ctx context.Context, tx *sql.Tx, id, tenderID string, payload map[string]any) error
}

type sqlTenderRepository struct {
	db *sql.DB
}

func NewTenderRepository(db *sql.DB) TenderRepository {
	return &sqlTenderRepository{db: db}
}

func (r *sqlTenderRepository) GetCriteria(ctx context.Context, tenderID string) ([]map[string]any, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT id, payload FROM criteria WHERE tender_id=$1`, tenderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var criteria []map[string]any
	for rows.Next() {
		var id string
		var payload []byte
		if err := rows.Scan(&id, &payload); err != nil {
			continue
		}
		var m map[string]any
		if err := json.Unmarshal(payload, &m); err == nil {
			m["id"] = id
			criteria = append(criteria, m)
		}
	}
	return criteria, rows.Err()
}

func (r *sqlTenderRepository) GetBidderIDs(ctx context.Context, tenderID string) ([]string, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT id FROM bidders WHERE tender_id=$1`, tenderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			continue
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (r *sqlTenderRepository) GetBidderDocuments(ctx context.Context, bidderID string) ([]map[string]any, error) {
	rows, err := r.db.QueryContext(ctx, `SELECT id, filename, doc_type, ocr_payload FROM documents WHERE owner_type='bidder' AND owner_id=$1`, bidderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var docs []map[string]any
	for rows.Next() {
		var id, fname, dtype string
		var ocrRaw []byte
		if err := rows.Scan(&id, &fname, &dtype, &ocrRaw); err != nil {
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
	return docs, rows.Err()
}

func (r *sqlTenderRepository) WithTransaction(ctx context.Context, fn func(*sql.Tx) error) error {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if err := fn(tx); err != nil {
		return err
	}
	return tx.Commit()
}

func (r *sqlTenderRepository) ClearTenderResults(ctx context.Context, tx *sql.Tx, tenderID string) error {
	queries := []string{
		`DELETE FROM decisions WHERE tender_id=$1`,
		`DELETE FROM evaluations WHERE tender_id=$1`,
		`DELETE FROM review_queue WHERE tender_id=$1`,
	}
	for _, q := range queries {
		if _, err := tx.ExecContext(ctx, q, tenderID); err != nil {
			return err
		}
	}
	return nil
}

func (r *sqlTenderRepository) SaveDecision(ctx context.Context, tx *sql.Tx, d map[string]any, tenderID, checksum string) error {
	id, _ := d["id"].(string)
	if id == "" {
		// handle uuid in service ideally, but fallback for safety
	}
	bid, _ := d["bidder_id"].(string)
	crid, _ := d["criterion_id"].(string)
	payload, _ := json.Marshal(d)
	
	_, err := tx.ExecContext(ctx,
		`INSERT INTO decisions (id, tender_id, bidder_id, criterion_id, payload, checksum) VALUES ($1,$2,$3::uuid,$4,$5::jsonb,$6)`,
		id, tenderID, bid, crid, string(payload), checksum)
	return err
}

func (r *sqlTenderRepository) SaveEvaluation(ctx context.Context, tx *sql.Tx, id, tenderID, status, graph string) error {
	_, err := tx.ExecContext(ctx,
		`INSERT INTO evaluations (id, tender_id, status, graph) VALUES ($1,$2,$3,$4::jsonb)`,
		id, tenderID, status, graph)
	return err
}

func (r *sqlTenderRepository) SaveReviewItem(ctx context.Context, tx *sql.Tx, id, tenderID string, payload map[string]any) error {
	p, _ := json.Marshal(payload)
	bid, _ := payload["bidder_id"].(string)
	crid, _ := payload["criterion_id"].(string)
	
	_, err := tx.ExecContext(ctx,
		`INSERT INTO review_queue (id, tender_id, bidder_id, criterion_id, status, payload) VALUES ($1,$2::uuid,$3::uuid,$4,'open',$5::jsonb)`,
		id, tenderID, bid, crid, string(p))
	return err
}
