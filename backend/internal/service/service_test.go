package service

import (
	"context"
	"testing"
	"github.com/tendersense/backend/internal/repository"
)

// Minimal mock for testing
type mockRepo struct {
	repository.TenderRepository
	getCriteriaFn func() ([]map[string]any, error)
}

func (m *mockRepo) GetCriteria(ctx context.Context, id string) ([]map[string]any, error) {
	return m.getCriteriaFn()
}

func TestTriggerEvaluation_NoCriteria(t *testing.T) {
	repo := &mockRepo{
		getCriteriaFn: func() ([]map[string]any, error) {
			return []map[string]any{}, nil
		},
	}
	svc := NewTenderService(repo)
	
	_, err := svc.TriggerEvaluation(context.Background(), "test-tender")
	if err == nil {
		t.Fatal("expected error when no criteria found, got nil")
	}
	if err.Error() != "no criteria found for tender" {
		t.Fatalf("expected specific error message, got: %v", err)
	}
}
