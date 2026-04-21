package handlers

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

var (
	aiClient = &http.Client{
		Timeout: 120 * time.Second, // Long timeout for LLM processing
	}
)

func AIServiceURL() string {
	u := os.Getenv("AI_SERVICE_URL")
	if u == "" {
		return "http://localhost:8081"
	}
	return u
}

func PostJSON(ctx context.Context, path string, body any, out any) error {
	if ctx == nil {
		ctx = context.Background()
	}
	b, err := json.Marshal(body)
	if err != nil {
		return fmt.Errorf("marshal body: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, AIServiceURL()+path, bytes.NewReader(b))
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := aiClient.Do(req)
	if err != nil {
		return fmt.Errorf("call ai service: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 300 {
		data, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20)) // cap error body at 1 MiB
		return fmt.Errorf("ai service error (status %d): %s", resp.StatusCode, string(data))
	}

	if out != nil {
		if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
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
