package handlers

import (
	"database/sql"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"github.com/gin-gonic/gin"
)

// UploadDataDir returns an absolute upload root (DATA_DIR or default data/uploads).
func UploadDataDir() string {
	d := strings.TrimSpace(os.Getenv("DATA_DIR"))
	if d == "" {
		d = "data/uploads"
	}
	abs, err := filepath.Abs(d)
	if err != nil {
		return filepath.Clean(d)
	}
	return abs
}

var allowedUploadExts = map[string]struct{}{
	".pdf": {}, ".png": {}, ".jpg": {}, ".jpeg": {}, ".tif": {}, ".tiff": {},
}

// Allowed bidder document types (must align with UI + decision_engine source_priority).
var allowedBidderDocTypes = map[string]struct{}{
	"supporting":            {},
	"ca_certificate":        {},
	"gst_certificate":       {},
	"audited_balance_sheet": {},
	"itr":                   {},
	"iso_certificate":       {},
	"experience_letters":    {},
	"experience_letter":     {},
	"work_order":            {},
	"bank_statement":        {},
	"balance_sheet":         {},
	"similar_projects":      {},
	"technical_brochure":    {},
}

// NormalizeBidderDocType returns a canonical doc_type for storage, or ("", false) if unknown.
func NormalizeBidderDocType(raw string) (string, bool) {
	dt := strings.TrimSpace(strings.ToLower(raw))
	if dt == "" {
		return "supporting", true
	}
	if _, ok := allowedBidderDocTypes[dt]; !ok {
		return "", false
	}
	return dt, true
}

func extAllowed(filename string) bool {
	ext := strings.ToLower(filepath.Ext(filepath.Base(filename)))
	if ext == "" {
		return false
	}
	_, ok := allowedUploadExts[ext]
	return ok
}

// safeUploadFilename returns a basename safe for storage and true if extension is allowed.
func safeUploadFilename(original string) (base string, ok bool) {
	base = filepath.Base(original)
	if base == "." || base == string(filepath.Separator) || base == "" {
		return "", false
	}
	if strings.Contains(base, "..") {
		return "", false
	}
	if !extAllowed(base) {
		return "", false
	}
	return base, true
}

// RequireTenderOwner sends 404/403/500 JSON and returns false if the caller cannot access the tender.
func RequireTenderOwner(db *sql.DB, c *gin.Context, tenderID string) bool {
	uid := c.GetString("user_id")
	var owner string
	err := db.QueryRow(`SELECT owner_id::text FROM tenders WHERE id=$1`, tenderID).Scan(&owner)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, gin.H{"error": "tender not found"})
		return false
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "lookup failed"})
		return false
	}
	if owner != uid {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return false
	}
	return true
}

// RequireBidderForOwner resolves the bidder's tender and ensures the tender belongs to the caller.
func RequireBidderForOwner(db *sql.DB, c *gin.Context, bidderID string) (tenderID string, ok bool) {
	uid := c.GetString("user_id")
	var owner string
	err := db.QueryRow(`
		SELECT b.tender_id::text, t.owner_id::text
		FROM bidders b
		JOIN tenders t ON t.id = b.tender_id
		WHERE b.id=$1`, bidderID).Scan(&tenderID, &owner)
	if err == sql.ErrNoRows {
		c.JSON(http.StatusNotFound, gin.H{"error": "bidder not found"})
		return "", false
	}
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "lookup failed"})
		return "", false
	}
	if owner != uid {
		c.JSON(http.StatusForbidden, gin.H{"error": "forbidden"})
		return "", false
	}
	return tenderID, true
}
