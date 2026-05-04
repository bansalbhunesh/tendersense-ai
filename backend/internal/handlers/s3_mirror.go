package handlers

import (
	"context"
	"database/sql"
	"log"
	"os"
	"time"

	"github.com/tendersense/backend/internal/objectstore"
)

// tryMirrorDocumentToS3 uploads a successfully processed local file to S3 when configured,
// then points storage_key at s3:bucket:key and removes the local copy (OCR JSON already in DB).
// Skips upload/removal if OCR was not persisted — the file remains the only copy until DB has ocr_payload.
func tryMirrorDocumentToS3(db *sql.DB, docID, localPath, logicalName string) {
	st, ok := objectstore.FromEnv()
	if !ok {
		return
	}
	var ocrNull bool
	if err := db.QueryRow(`SELECT ocr_payload IS NULL FROM documents WHERE id=$1`, docID).Scan(&ocrNull); err != nil {
		log.Printf("s3_mirror_skip doc_id=%s err=%v", docID, err)
		return
	}
	if ocrNull {
		log.Printf("s3_mirror_skip doc_id=%s reason=no_ocr_payload_local_retained", docID)
		return
	}
	key := objectstore.ObjectKey(docID, logicalName)
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Minute)
	defer cancel()
	if err := st.UploadLocal(ctx, key, localPath); err != nil {
		log.Printf("s3_upload_failed doc_id=%s err=%v", docID, err)
		return
	}
	ref := objectstore.StorageRef(st.Bucket, key)
	if _, err := db.Exec(`UPDATE documents SET storage_key=$1 WHERE id=$2`, ref, docID); err != nil {
		log.Printf("s3_storage_key_update_failed doc_id=%s err=%v", docID, err)
		return
	}
	if err := os.Remove(localPath); err != nil {
		log.Printf("s3_local_remove_failed doc_id=%s err=%v", docID, err)
	}
}
