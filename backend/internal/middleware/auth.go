package middleware

import (
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"

	"github.com/tendersense/backend/internal/util"
)

type Claims struct {
	UserID string `json:"uid"`
	Email  string `json:"email"`
	jwt.RegisteredClaims
}

func JWTSecret() []byte {
	return []byte(os.Getenv("JWT_SECRET"))
}

func GenerateToken(userID, email string) (string, error) {
	if len(JWTSecret()) == 0 {
		return "", errors.New("JWT_SECRET not configured")
	}
	claims := Claims{
		UserID: userID,
		Email:  email,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(24 * time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return t.SignedString(JWTSecret())
}

func AuthRequired() gin.HandlerFunc {
	return func(c *gin.Context) {
		if len(JWTSecret()) == 0 {
			util.InternalError(c, "authentication is not configured")
			return
		}
		h := c.GetHeader("Authorization")
		if h == "" || !strings.HasPrefix(h, "Bearer ") {
			util.Unauthorized(c, "missing bearer token")
			return
		}
		raw := strings.TrimPrefix(h, "Bearer ")
		var claims Claims
		_, err := jwt.ParseWithClaims(
			raw,
			&claims,
			func(t *jwt.Token) (any, error) {
				if t.Method != jwt.SigningMethodHS256 {
					return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
				}
				return JWTSecret(), nil
			},
			jwt.WithValidMethods([]string{jwt.SigningMethodHS256.Alg()}),
			jwt.WithExpirationRequired(),
		)
		if err != nil {
			util.Unauthorized(c, "invalid or expired token")
			return
		}
		c.Set("user_id", claims.UserID)
		c.Set("email", claims.Email)
		c.Next()
	}
}
