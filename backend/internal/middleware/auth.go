package middleware

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/golang-jwt/jwt/v5"

	"github.com/tendersense/backend/internal/revocation"
	"github.com/tendersense/backend/internal/util"
)

type Claims struct {
	UserID string `json:"uid"`
	Email  string `json:"email"`
	Role   string `json:"role"`
	// TV is bumped on password reset and logout-all so all prior access JWTs fail.
	TV int64 `json:"tv"`
	jwt.RegisteredClaims
}

func JWTSecret() []byte {
	return []byte(os.Getenv("JWT_SECRET"))
}

// GenerateAccessToken issues a short-lived JWT (see JWT_ACCESS_TTL) with a unique jti.
// tokenVersion must match users.access_token_version when the token is validated.
func GenerateAccessToken(userID, email, role string, tokenVersion int64) (string, error) {
	if len(JWTSecret()) == 0 {
		return "", errors.New("JWT_SECRET not configured")
	}
	jti, err := randomJTI()
	if err != nil {
		return "", err
	}
	claims := Claims{
		UserID: userID,
		Email:  email,
		Role:   role,
		TV:     tokenVersion,
		RegisteredClaims: jwt.RegisteredClaims{
			ID:        jti,
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(AccessTokenTTL())),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	t := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return t.SignedString(JWTSecret())
}

func randomJTI() (string, error) {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// AuthRequired validates the bearer JWT, rejects revoked jtis, and reloads role from the database.
func AuthRequired(db *sql.DB) gin.HandlerFunc {
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
		jti := strings.TrimSpace(claims.ID)
		ctx := c.Request.Context()
		if db != nil && jti != "" {
			revoked, rerr := revocation.AccessJTIRevoked(ctx, db, jti)
			if rerr != nil {
				util.InternalError(c, "session check failed")
				return
			}
			if revoked {
				util.Unauthorized(c, "token has been revoked")
				return
			}
		}
		var dbRole string
		var dbTV int64
		if db != nil {
			err = db.QueryRowContext(ctx,
				`SELECT COALESCE(role,'officer'), COALESCE(access_token_version, 0) FROM users WHERE id = $1::uuid`,
				claims.UserID,
			).Scan(&dbRole, &dbTV)
			if err == sql.ErrNoRows {
				util.Unauthorized(c, "invalid or expired token")
				return
			}
			if err != nil {
				util.InternalError(c, "authorization failed")
				return
			}
			if claims.TV != dbTV {
				util.Unauthorized(c, "session invalidated")
				return
			}
		} else {
			dbRole = claims.Role
			if dbRole == "" {
				dbRole = "officer"
			}
		}
		c.Set("user_id", claims.UserID)
		c.Set("email", claims.Email)
		c.Set("role", dbRole)
		c.Set("access_jti", jti)
		if claims.ExpiresAt != nil {
			c.Set("access_exp", claims.ExpiresAt.Time)
		}
		c.Next()
	}
}
