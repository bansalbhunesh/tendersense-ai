# Security and session semantics

This document summarizes **production-oriented** auth behavior for operators and judges. Implementation lives in `backend/internal/middleware`, `backend/internal/handlers/auth.go`, `backend/internal/revocation`, and migrations for `refresh_tokens` / `access_token_version`.

## Access and refresh tokens

- **Access JWT** — short-lived (default **15 minutes** via `JWT_ACCESS_TTL`). Carries a **JTI** checked against a revocation path (Postgres + optional Redis cache).
- **Refresh token** — opaque value in an **HttpOnly** cookie (rotation on each refresh). Stored hashed in Postgres with **JTI** for revocation and a cleanup loop for expired rows.

## Refresh rotation and optional `access_token`

`POST /api/v1/auth/refresh` may accept an optional **`access_token`** in the JSON body (the current access JWT).

- When the client **sends** the previous access token, the server can **revoke that access JTI** immediately as part of refresh, shrinking the overlap window.
- When the client **omits** it (field optional for backward compatibility), the **previous access JWT remains valid until it expires naturally** (at most one **access TTL**, e.g. 15 minutes), even though refresh was already rotated. This is an acceptable trade-off; clients that want tighter binding should always send the current access token on refresh.

## Password reset and logout-all

Bumping **`access_token_version`** invalidates all outstanding access JWTs for that user after the version check. Session-related Redis caches for role/version are invalidated on password reset and logout-all so cached metadata cannot outlive those bumps.

## Object storage

Presigned URLs are **short-lived**. Upload size limits are enforced at the API layer; see deployment docs for `MAX_JSON_BODY_BYTES` / multipart limits.

## Rate limiting and headers

Redis-backed rate limits apply where configured; security headers middleware is enabled for the API. See `backend/main.go` and middleware packages for defaults.

## Tender ownership checks

`RequireTenderOwner` resolves ownership against **Postgres** so permissions stay consistent with the database source of truth. Role and `access_token_version` for `AuthRequired` are cached briefly in Redis when `REDIS_URL` is set to avoid a full user row read on every request.
