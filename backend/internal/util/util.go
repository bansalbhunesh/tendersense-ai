package util

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"mime/multipart"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

var (
	aiClient = &http.Client{
		Timeout: 120 * time.Second,
	}

	// Long-running evaluate: single attempt, no stacked retries (avoids 3× LLM load on timeout).
	evaluateClient = &http.Client{
		Timeout: 15 * time.Minute,
	}
	aiCircuit = &simpleCircuitBreaker{
		failureThreshold: 5,
		cooldown:         30 * time.Second,
	}
)

const postJSONMaxAttempts = 3

const postDocumentMaxAttempts = 5

type simpleCircuitBreaker struct {
	mu               sync.Mutex
	consecutiveFails int
	openUntil        time.Time
	failureThreshold int
	cooldown         time.Duration
}

func (cb *simpleCircuitBreaker) allow() bool {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	return time.Now().After(cb.openUntil)
}

func (cb *simpleCircuitBreaker) onSuccess() {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	cb.consecutiveFails = 0
	cb.openUntil = time.Time{}
}

func (cb *simpleCircuitBreaker) onFailure() {
	cb.mu.Lock()
	defer cb.mu.Unlock()
	cb.consecutiveFails++
	if cb.consecutiveFails >= cb.failureThreshold {
		cb.openUntil = time.Now().Add(cb.cooldown)
	}
}

// HTTPStatusError is returned for AI HTTP 4xx responses (no retry).
type HTTPStatusError struct {
	StatusCode int
	Body       string
}

func (e *HTTPStatusError) Error() string {
	return fmt.Sprintf("ai service error (status %d): %s", e.StatusCode, e.Body)
}

func AIServiceURL() string {
	u := os.Getenv("AI_SERVICE_URL")
	if u == "" {
		return "http://localhost:8081"
	}
	return u
}

// PostEvaluateJSON calls /v1/evaluate once with a long client timeout (no retries).
func PostEvaluateJSON(ctx context.Context, body any, out any) error {
	if ctx == nil {
		ctx = context.Background()
	}
	return doPostJSON(ctx, evaluateClient, "/v1/evaluate", body, out)
}

// PostJSON calls the AI service with bounded retries; skips retries on 4xx and on context cancel.
func PostJSON(ctx context.Context, path string, body any, out any) error {
	if ctx == nil {
		ctx = context.Background()
	}
	if !aiCircuit.allow() {
		return fmt.Errorf("ai service circuit open; retry later")
	}
	var lastErr error
	for attempt := 1; attempt <= postJSONMaxAttempts; attempt++ {
		err := doPostJSON(ctx, aiClient, path, body, out)
		if err == nil {
			aiCircuit.onSuccess()
			return nil
		}
		var hs *HTTPStatusError
		if errors.As(err, &hs) {
			return err
		}
		lastErr = err
		aiCircuit.onFailure()
		if attempt >= postJSONMaxAttempts {
			break
		}
		backoff := time.Duration(1<<uint(attempt-1)) * 400 * time.Millisecond
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(backoff):
		}
	}
	return lastErr
}

func doPostJSON(ctx context.Context, client *http.Client, path string, body any, out any) error {
	b, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal body: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, AIServiceURL()+path, bytes.NewReader(b))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := client.Do(req)
	if err != nil {
		return fmt.Errorf("call ai service: %w", err)
	}
	defer resp.Body.Close()

	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 300 {
		if resp.StatusCode >= 400 && resp.StatusCode < 500 {
			return &HTTPStatusError{StatusCode: resp.StatusCode, Body: string(data)}
		}
		return fmt.Errorf("ai service error (status %d): %s", resp.StatusCode, string(data))
	}

	if out != nil {
		if err := json.Unmarshal(data, out); err != nil {
			return fmt.Errorf("decode response: %w", err)
		}
	}
	return nil
}

func ChecksumJSON(v any) string {
	b, err := json.Marshal(v)
	if err != nil {
		return "error-checksum"
	}
	h := sha256.Sum256(b)
	return "sha256:" + hex.EncodeToString(h[:])
}

// PostDocumentFile streams a local file to the AI service multipart OCR endpoint.
// Retries absorb cold starts and transient 5xx responses. Shared filesystem
// between backend and AI is not required.
func PostDocumentFile(ctx context.Context, absolutePath, documentID string, out any) error {
	if ctx == nil {
		ctx = context.Background()
	}
	if !aiCircuit.allow() {
		return fmt.Errorf("ai service circuit open; retry later")
	}
	var lastErr error
	for attempt := 1; attempt <= postDocumentMaxAttempts; attempt++ {
		err := postDocumentFileOnce(ctx, absolutePath, documentID, out)
		if err == nil {
			aiCircuit.onSuccess()
			return nil
		}
		var hs *HTTPStatusError
		if errors.As(err, &hs) {
			aiCircuit.onFailure()
			return err
		}
		lastErr = err
		aiCircuit.onFailure()
		if attempt >= postDocumentMaxAttempts {
			break
		}
		backoff := time.Duration(1<<uint(attempt-1)) * 1200 * time.Millisecond
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(backoff):
		}
	}
	return lastErr
}

func postDocumentFileOnce(ctx context.Context, absolutePath, documentID string, out any) error {
	f, err := os.Open(absolutePath)
	if err != nil {
		return fmt.Errorf("open upload file: %w", err)
	}
	defer f.Close()

	var body bytes.Buffer
	w := multipart.NewWriter(&body)
	part, err := w.CreateFormFile("file", filepath.Base(absolutePath))
	if err != nil {
		return fmt.Errorf("create multipart file field: %w", err)
	}
	if _, err := io.Copy(part, f); err != nil {
		return fmt.Errorf("copy file into multipart payload: %w", err)
	}
	if err := w.WriteField("document_id", documentID); err != nil {
		return fmt.Errorf("write multipart document_id: %w", err)
	}
	if err := w.Close(); err != nil {
		return fmt.Errorf("finalize multipart payload: %w", err)
	}
	contentType := w.FormDataContentType()

	req, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		AIServiceURL()+"/v1/process-document-upload",
		bytes.NewReader(body.Bytes()),
	)
	if err != nil {
		return fmt.Errorf("create multipart request: %w", err)
	}
	req.Header.Set("Content-Type", contentType)

	resp, err := aiClient.Do(req)
	if err != nil {
		return fmt.Errorf("call ai service: %w", err)
	}
	defer resp.Body.Close()

	data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if resp.StatusCode >= 300 {
		if resp.StatusCode >= 400 && resp.StatusCode < 500 {
			return &HTTPStatusError{StatusCode: resp.StatusCode, Body: string(data)}
		}
		return fmt.Errorf("ai service error (status %d): %s", resp.StatusCode, string(data))
	}
	if strings.Contains(string(data), `"ocr_failed"`) {
		return fmt.Errorf("ai service OCR failed")
	}
	if out != nil {
		if err := json.Unmarshal(data, out); err != nil {
			return fmt.Errorf("decode response: %w", err)
		}
	}
	return nil
}
