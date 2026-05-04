package objectstore

import (
	"context"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"
)

// Store wraps a MinIO/S3-compatible client for optional object storage.
type Store struct {
	cli    *minio.Client
	Bucket string
}

var (
	storeMu     sync.Mutex
	storeCached *Store
	storeOK     bool
	storeInited bool
)

// ResetFromEnvCacheForTesting clears the lazy singleton (tests only).
func ResetFromEnvCacheForTesting() {
	storeMu.Lock()
	defer storeMu.Unlock()
	storeInited = false
	storeCached = nil
	storeOK = false
}

// FromEnv returns a shared client when S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, and S3_BUCKET are set.
// The MinIO client and bucket existence check run once per process (not per request).
func FromEnv() (*Store, bool) {
	storeMu.Lock()
	defer storeMu.Unlock()
	if storeInited {
		return storeCached, storeOK
	}
	storeInited = true
	storeCached, storeOK = fromEnvOnce()
	return storeCached, storeOK
}

func fromEnvOnce() (*Store, bool) {
	endpoint := strings.TrimSpace(os.Getenv("S3_ENDPOINT"))
	access := strings.TrimSpace(os.Getenv("S3_ACCESS_KEY"))
	secret := strings.TrimSpace(os.Getenv("S3_SECRET_KEY"))
	bucket := strings.TrimSpace(os.Getenv("S3_BUCKET"))
	if endpoint == "" || access == "" || secret == "" || bucket == "" {
		return nil, false
	}
	secure := true
	switch strings.ToLower(strings.TrimSpace(os.Getenv("S3_USE_SSL"))) {
	case "false", "0", "no":
		secure = false
	}
	cli, err := minio.New(endpoint, &minio.Options{
		Creds:  credentials.NewStaticV4(access, secret, ""),
		Secure: secure,
	})
	if err != nil {
		log.Printf("objectstore: minio client init failed: %v", err)
		return nil, false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	exists, err := cli.BucketExists(ctx, bucket)
	if err != nil || !exists {
		log.Printf("objectstore: bucket %q missing or unreachable: %v", bucket, err)
		return nil, false
	}
	return &Store{cli: cli, Bucket: bucket}, true
}

// UploadLocal copies a file from disk into the bucket at key (no leading slash).
func (s *Store) UploadLocal(ctx context.Context, key, localPath string) error {
	ct := "application/octet-stream"
	switch strings.ToLower(filepath.Ext(key)) {
	case ".pdf":
		ct = "application/pdf"
	case ".png":
		ct = "image/png"
	case ".jpg", ".jpeg":
		ct = "image/jpeg"
	}
	_, err := s.cli.FPutObject(ctx, s.Bucket, key, localPath, minio.PutObjectOptions{ContentType: ct})
	return err
}

// PresignedGET returns a time-limited GET URL for key.
func (s *Store) PresignedGET(ctx context.Context, key string, ttl time.Duration) (string, error) {
	u, err := s.cli.PresignedGetObject(ctx, s.Bucket, key, ttl, nil)
	if err != nil {
		return "", err
	}
	return u.String(), nil
}

// ObjectKey builds a stable object path for a stored document.
func ObjectKey(docID, filename string) string {
	return fmt.Sprintf("documents/%s/%s", docID, filepath.Base(filename))
}

// StorageRef is the value written to documents.storage_key for S3-backed blobs.
func StorageRef(bucket, key string) string {
	return "s3:" + bucket + ":" + key
}

// ParseRef splits an s3:bucket:key ref; ok false if not an S3 ref.
func ParseRef(ref string) (bucket, key string, ok bool) {
	if !strings.HasPrefix(ref, "s3:") {
		return "", "", false
	}
	rest := strings.TrimPrefix(ref, "s3:")
	i := strings.IndexByte(rest, ':')
	if i <= 0 || i >= len(rest)-1 {
		return "", "", false
	}
	return rest[:i], rest[i+1:], true
}
