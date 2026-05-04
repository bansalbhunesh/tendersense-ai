# Deploying TenderSense AI

This stack is designed to run as **three moving parts** (Postgres, Go API, Python AI worker) plus the **Vite frontend** (static hosting or `npm run dev`). Below is a practical path to a **public URL** and optional **object storage**.

## Minimal production checklist

1. **Postgres** — managed RDS/Neon/Supabase or self-hosted `postgres:16`.
2. **Secrets** — `JWT_SECRET` (≥32 chars), `DATABASE_URL`, `AI_SERVICE_URL` pointing at the Python service (internal URL in the same VPC is ideal).
3. **CORS** — backend `ALLOWED_ORIGINS` / `ALLOWED_ORIGIN_REGEX` must include your frontend origin.
4. **AI service** — `ALLOWED_ORIGINS`, `DATA_DIR` on a persistent volume shared with the backend upload directory (or rely on multipart upload + S3 mirror; see below).
5. **Auth sessions** — tune `JWT_ACCESS_TTL` (e.g. `15m`) and `JWT_REFRESH_TTL` (e.g. `720h`). Clients should store `refresh_token` and call `POST /api/v1/auth/refresh`.

## Fly.io (example layout)

- **App `tendersense-api`**: Docker image from `backend/Dockerfile`, env `DATABASE_URL`, `AI_SERVICE_URL=https://tendersense-ai.internal:8081` (Fly private networking) or public URL if split.
- **App `tendersense-ai`**: Docker image from `ai-service/Dockerfile`, attach volume at `/app/data/uploads`.
- **Postgres**: Fly Postgres or external.
- **Frontend**: Vercel/Netlify static build from `frontend` with `VITE_*` API base if used.

Exact `fly.toml` files vary by region and org; generate with `fly launch` in each directory and merge env from `.env.example`.

## Optional: S3 / MinIO (horizontal storage)

When `S3_ENDPOINT`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, and `S3_BUCKET` are set, successful document uploads are **mirrored** to the bucket and `storage_key` becomes `s3:bucket:key`. Officers can obtain a short-lived download URL via:

`GET /api/v1/documents/:id/presign`

Set `S3_USE_SSL=false` for plain HTTP MinIO inside Docker.

Example `docker-compose` MinIO (dev) — **never hardcode** root passwords in repo YAML; use `.env` (see root `.env.example`):

```yaml
minio:
  image: minio/minio:latest
  command: server /data --console-address ":9001"
  environment:
    MINIO_ROOT_USER: ${MINIO_ROOT_USER:-minio}
    MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD:?set MINIO_ROOT_PASSWORD in .env}
  ports:
    - "9000:9000"
    - "9001:9001"
```

Create a bucket (e.g. `tendersense`) via the console, then set backend `S3_*` env to match (`S3_SECRET_KEY` must equal `MINIO_ROOT_PASSWORD` when using root credentials in dev).

Session semantics (refresh body, access TTL overlap) are documented in [`docs/SECURITY.md`](SECURITY.md).

## RBAC

Users have a `role` column (`officer` default). Set `admin` in SQL for support accounts:

```sql
UPDATE users SET role = 'admin' WHERE email = 'you@agency.gov.in';
```

Admins can list all tenders and access any tender/bidder route guarded by `RequireTenderOwner` / `RequireBidderForOwner`.

## Long-running evaluation (no single blocking gateway hop)

The officer UI calls **`POST /api/v1/tenders/:id/evaluate`**, which enqueues **`evaluation_jobs`** and returns a **`job_id`**. Poll **`GET /api/v1/tenders/:id/evaluate/jobs/:job`** until `status` is `completed` or `failed`. The Go worker holds the long **Go → Python AI** HTTP call (long client timeout); the browser only waits on the lightweight job status endpoint.

## Judge / demo assets

Add screenshots or a short screen recording under `docs/screenshots/` and link them from the root `README.md` **Demo media** section when preparing a submission.
