package models

import "time"

type User struct {
	ID           string    `json:"id"`
	Email        string    `json:"email"`
	PasswordHash string    `json:"-"`
	Role         string    `json:"role"`
	CreatedAt    time.Time `json:"created_at"`
}

type Tender struct {
	ID          string    `json:"id"`
	Title       string    `json:"title"`
	Description string    `json:"description,omitempty"`
	OwnerID     string    `json:"owner_id"`
	Status      string    `json:"status"`
	CreatedAt   time.Time `json:"created_at"`
}

type Criterion struct {
	ID                     string   `json:"id"`
	TenderID               string   `json:"tender_id"`
	TextRaw                string   `json:"text_raw"`
	Field                  string   `json:"field"`
	Operator               string   `json:"operator"`
	Value                  float64  `json:"value"`
	Unit                   string   `json:"unit"`
	Mandatory              bool     `json:"mandatory"`
	SourcePriority         []string `json:"source_priority"`
	DependsOn              *string  `json:"depends_on,omitempty"`
	SemanticAmbiguityScore float64  `json:"semantic_ambiguity_score"`
	ExtractionConfidence   float64  `json:"extraction_confidence"`
	Temporal               any      `json:"temporal,omitempty"`
}

type Bidder struct {
	ID        string    `json:"id"`
	TenderID  string    `json:"tender_id"`
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"created_at"`
}

type Document struct {
	ID         string    `json:"id"`
	OwnerType  string    `json:"owner_type"`
	OwnerID    string    `json:"owner_id"`
	Filename   string    `json:"filename"`
	StorageKey string    `json:"storage_key"`
	DocType    string    `json:"doc_type"`
	Quality    float64   `json:"quality_score"`
	CreatedAt  time.Time `json:"created_at"`
}

const (
	VerdictEligible     = "ELIGIBLE"
	VerdictNotEligible  = "NOT_ELIGIBLE"
	VerdictNeedsReview  = "NEEDS_REVIEW"
	ReasonNoEvidence    = "NO_EVIDENCE"
	ReasonConflict      = "CONFLICT_DETECTED"
	ReasonLowOCR        = "LOW_OCR_CONFIDENCE"
	ReasonLowConfidence = "LOW_CONFIDENCE"
)

type VerdictNode struct {
	CriterionID         string   `json:"criterion_id"`
	BidderID            string   `json:"bidder_id"`
	Verdict             string   `json:"verdict"`
	Reason              string   `json:"reason,omitempty"`
	Confidence          float64  `json:"confidence"`
	EvidenceUsed        []string `json:"evidence_used"`
	EvidenceConflicting []string `json:"evidence_conflicting,omitempty"`
	ReviewerRequired    bool     `json:"reviewer_required"`
	Reasoning           string   `json:"reasoning,omitempty"`
}

type DecisionRecord struct {
	DecisionID      string         `json:"decision_id"`
	TenderID        string         `json:"tender_id"`
	BidderID        string         `json:"bidder_id"`
	CriterionID     string         `json:"criterion_id"`
	Verdict         string         `json:"verdict"`
	Confidence      float64        `json:"confidence"`
	EvidenceChain   []EvidenceStep `json:"evidence_chain"`
	Reasoning       string         `json:"reasoning"`
	ReviewerOverride *string       `json:"reviewer_override,omitempty"`
	CreatedAt       time.Time      `json:"created_at"`
	Checksum        string         `json:"checksum"`
}

type EvidenceStep struct {
	Document        string  `json:"document"`
	Page            int     `json:"page"`
	BoundingBox     any     `json:"bounding_box,omitempty"`
	ExtractedValue  string  `json:"extracted_value"`
	NormalizedValue float64 `json:"normalized_value"`
	OCRConfidence   float64 `json:"ocr_confidence"`
}
