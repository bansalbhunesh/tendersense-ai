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
	"net/http"
	"os"
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
)

const postJSONMaxAttempts = 3

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
	var lastErr error
	for attempt := 1; attempt <= postJSONMaxAttempts; attempt++ {
		err := doPostJSON(ctx, aiClient, path, body, out)
		if err == nil {
			return nil
		}
		var hs *HTTPStatusError
		if errors.As(err, &hs) {
			return err
		}
		lastErr = err
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
