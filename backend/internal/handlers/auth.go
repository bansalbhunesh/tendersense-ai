package handlers

import (
	"database/sql"
	"net/http"
	"strings"

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

func Register(db *sql.DB) gin.HandlerFunc {
	return func(c *gin.Context) {
		var req registerReq
		if err := c.ShouldBindJSON(&req); err != nil {
			util.BadRequest(c, err.Error())
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
				util.Conflict(c, "email exists")
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
