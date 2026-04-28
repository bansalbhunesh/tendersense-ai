package handlers

import (
	"bytes"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"

	"github.com/tendersense/backend/internal/middleware"
	"github.com/tendersense/backend/internal/util"
)

type registerReq struct {
	Email    string `json:"email" binding:"required,email"`
	Password string `json:"password" binding:"required,min=8"`
}

type forgotPasswordReq struct {
	Email string `json:"email" binding:"required,email"`
}

type resetPasswordReq struct {
	Email       string `json:"email" binding:"required,email"`
	ResetToken  string `json:"reset_token" binding:"required,min=16"`
	NewPassword string `json:"new_password" binding:"required,min=8"`
}

var (
	hasLetter = regexp.MustCompile(`[A-Za-z]`)
	hasDigit  = regexp.MustCompile(`\d`)
)

func normalizeEmail(raw string) string {
	return strings.ToLower(strings.TrimSpace(raw))
}

func validatePasswordStrength(password string) string {
	if len(password) < 8 {
		return "password must be at least 8 characters"
	}
	if !hasLetter.MatchString(password) || !hasDigit.MatchString(password) {
		return "password must include at least one letter and one number"
	}
	return ""
}

func issueResetToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(b), nil
}

func sendResetEmail(email, resetToken string) error {
	apiKey := strings.TrimSpace(os.Getenv("RESEND_API_KEY"))
	from := strings.TrimSpace(os.Getenv("RESET_EMAIL_FROM"))
	appURL := strings.TrimSpace(os.Getenv("APP_BASE_URL"))
	if apiKey == "" || from == "" || appURL == "" {
		return fmt.Errorf("reset email is not configured (need RESEND_API_KEY, RESET_EMAIL_FROM, APP_BASE_URL)")
	}
	link := fmt.Sprintf(
		"%s/?view=forgot&mode=reset&email=%s&token=%s",
		strings.TrimRight(appURL, "/"),
		url.QueryEscape(email),
		url.QueryEscape(resetToken),
	)
	body := map[string]any{
		"from":    from,
		"to":      []string{email},
		"subject": "TenderSense password reset",
		"text": "You requested a TenderSense password reset.\n\n" +
			"Open this link and complete reset within 15 minutes:\n" + link + "\n\n" +
			"If you did not request this, ignore this email.",
		"html": "<p>You requested a TenderSense password reset.</p>" +
			"<p><a href=\"" + link + "\">Reset your password</a></p>" +
			"<p>This link expires in 15 minutes. If you did not request this, ignore this email.</p>",
	}
	payload, _ := json.Marshal(body)
	req, err := http.NewRequest(http.MethodPost, "https://api.resend.com/emails", bytes.NewReader(payload))
	if err != nil {
		return err
	}
	req.Header.Set("Authorization", "Bearer "+apiKey)
	req.Header.Set("Content-Type", "application/json")
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		data, _ := io.ReadAll(io.LimitReader(resp.Body, 2048))
		return fmt.Errorf("resend status %d: %s", resp.StatusCode, string(data))
	}
	return nil
}

func Register(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req registerReq
		if err := c.ShouldBindJSON(&req); err != nil {
			util.BadRequest(c, err.Error())
			return
		}
		req.Email = normalizeEmail(req.Email)
		if req.Email == "" {
			util.BadRequest(c, "email is required")
			return
		}
		if msg := validatePasswordStrength(req.Password); msg != "" {
			util.BadRequest(c, msg)
			return
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
		if err != nil {
			util.InternalError(c, "hash")
			return
		}
		id := uuid.NewString()
		_, err = db.Exec(`INSERT INTO users (id, email, password_hash) VALUES ($1,$2,$3)`, id, req.Email, string(hash))
		if err != nil {
			if strings.Contains(err.Error(), "unique constraint") || strings.Contains(err.Error(), "duplicate key") {
				util.Conflict(c, "an account with this email already exists")
			} else {
				util.InternalError(c, "database error")
			}
			return
		}
		token, err := middleware.GenerateToken(id, req.Email)
		if err != nil {
			util.InternalError(c, "failed to generate token")
			return
		}
		c.JSON(http.StatusCreated, gin.H{"token": token, "user_id": id})
	}
}

func Login(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req registerReq
		if err := c.ShouldBindJSON(&req); err != nil {
			util.BadRequest(c, err.Error())
			return
		}
		req.Email = normalizeEmail(req.Email)
		if req.Email == "" {
			util.BadRequest(c, "email is required")
			return
		}
		var id, hash string
		err := db.QueryRow(`SELECT id, password_hash FROM users WHERE email=$1`, req.Email).Scan(&id, &hash)
		if err != nil {
			util.Unauthorized(c, "invalid credentials")
			return
		}
		if bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.Password)) != nil {
			util.Unauthorized(c, "invalid credentials")
			return
		}
		token, err := middleware.GenerateToken(id, req.Email)
		if err != nil {
			util.InternalError(c, "failed to generate token")
			return
		}
		c.JSON(http.StatusOK, gin.H{"token": token, "user_id": id})
	}
}

func ForgotPassword(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req forgotPasswordReq
		if err := c.ShouldBindJSON(&req); err != nil {
			util.BadRequest(c, err.Error())
			return
		}
		req.Email = normalizeEmail(req.Email)
		if req.Email == "" {
			util.BadRequest(c, "email is required")
			return
		}

		var userID string
		err := db.QueryRow(`SELECT id FROM users WHERE email=$1`, req.Email).Scan(&userID)
		// Do not leak whether account exists.
		if err == sql.ErrNoRows {
			c.JSON(http.StatusOK, gin.H{"message": "If an account exists, a reset token has been issued."})
			return
		}
		if err != nil {
			util.InternalError(c, "database error")
			return
		}

		token, err := issueResetToken()
		if err != nil {
			util.InternalError(c, "failed to issue reset token")
			return
		}
		expiresAt := time.Now().Add(15 * time.Minute)
		_, err = db.Exec(
			`INSERT INTO password_reset_tokens (email, token, expires_at, used) VALUES ($1,$2,$3,false)`,
			req.Email, token, expiresAt,
		)
		if err != nil {
			util.InternalError(c, "failed to persist reset token")
			return
		}
		if err := sendResetEmail(req.Email, token); err != nil {
			// Optional dev fallback: expose token directly for non-email environments.
			if strings.EqualFold(strings.TrimSpace(os.Getenv("ALLOW_INSECURE_RESET_TOKEN_RESPONSE")), "true") {
				log.Printf("warn: reset email failed for %s, returning token due to ALLOW_INSECURE_RESET_TOKEN_RESPONSE=true: %v", req.Email, err)
				c.JSON(http.StatusOK, gin.H{
					"message":     "Reset token issued (dev fallback).",
					"reset_token": token,
					"expires_at":  expiresAt.UTC().Format(time.RFC3339),
				})
				return
			}
			log.Printf("warn: reset email delivery failed for %s: %v", req.Email, err)
			util.InternalError(c, "failed to send reset email")
			return
		}
		c.JSON(http.StatusOK, gin.H{
			"message":    "If an account exists, a password reset email has been sent.",
			"expires_at": expiresAt.UTC().Format(time.RFC3339),
		})
	}
}

func ResetPassword(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req resetPasswordReq
		if err := c.ShouldBindJSON(&req); err != nil {
			util.BadRequest(c, err.Error())
			return
		}
		req.Email = normalizeEmail(req.Email)
		req.ResetToken = strings.TrimSpace(req.ResetToken)
		if req.Email == "" || req.ResetToken == "" {
			util.BadRequest(c, "email and reset token are required")
			return
		}
		if msg := validatePasswordStrength(req.NewPassword); msg != "" {
			util.BadRequest(c, msg)
			return
		}

		var tokenID int64
		err := db.QueryRow(
			`SELECT id FROM password_reset_tokens
			 WHERE email=$1 AND token=$2 AND used=false AND expires_at > now()
			 ORDER BY created_at DESC LIMIT 1`,
			req.Email, req.ResetToken,
		).Scan(&tokenID)
		if err == sql.ErrNoRows {
			util.BadRequest(c, "invalid or expired reset token")
			return
		}
		if err != nil {
			util.InternalError(c, "database error")
			return
		}

		hash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
		if err != nil {
			util.InternalError(c, "hash")
			return
		}

		tx, err := db.Begin()
		if err != nil {
			util.InternalError(c, "database transaction error")
			return
		}
		defer tx.Rollback()

		if _, err := tx.Exec(`UPDATE users SET password_hash=$1 WHERE email=$2`, string(hash), req.Email); err != nil {
			util.InternalError(c, "failed to update password")
			return
		}
		if _, err := tx.Exec(`UPDATE password_reset_tokens SET used=true WHERE id=$1`, tokenID); err != nil {
			util.InternalError(c, "failed to consume reset token")
			return
		}
		if _, err := tx.Exec(`UPDATE password_reset_tokens SET used=true WHERE email=$1 AND id<>$2 AND used=false`, req.Email, tokenID); err != nil {
			util.InternalError(c, "failed to invalidate previous reset tokens")
			return
		}
		if err := tx.Commit(); err != nil {
			util.InternalError(c, "failed to commit password reset")
			return
		}
		c.JSON(http.StatusOK, gin.H{"message": "Password reset successful. You can now sign in."})
	}
}
