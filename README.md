# TenderSense AI

> Explainable, auditable AI for **government tender evaluation** — built for Indian procurement realities (CRPF reference deployment).

[![CI](https://github.com/bansalbhunesh/tendersense-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/bansalbhunesh/tendersense-ai/actions/workflows/ci.yml)
![tests](https://img.shields.io/badge/tests-189%20passing-brightgreen)
![go](https://img.shields.io/badge/backend-Go%201.22-00ADD8)
![python](https://img.shields.io/badge/ai--service-FastAPI%20%7C%20Python%203.12-3776AB)
![web](https://img.shields.io/badge/frontend-Vite%20%7C%20React%2018%20%7C%20TS%20strict-646CFF)
![bharat](https://img.shields.io/badge/Bharat--first-EN%20%2B%20%E0%A4%B9%E0%A4%BF%E0%A4%82%20%E2%80%A2%20Bhashini%20%E2%80%A2%20Sovereign%20mode-FF9933)
![license](https://img.shields.io/badge/license-MIT-blue)

```
Tender PDF ─► OCR + Native parse ─► Structured criteria  ─┐
                                                          ├─► Decision engine ─► ELIGIBLE / NOT_ELIGIBLE / NEEDS_REVIEW
Bidder docs ─► OCR + Evidence extract ─► Normalized facts ┘                            │  (with confidence + reasoning)
                                                                                       ▼
                                                                 Officer review queue • Audit log • Reasoning graph
```

---

## Why this matters

Indian government procurement runs on long PDFs and inconsistent evidence. Today, eligibility is decided manually — slow, hard to audit, and prone to silent error. Existing automation tools either keyword-match (brittle) or hand the decision to a black-box LLM (unauditable).

**TenderSense AI is built around three commitments:**

1. **Never silently reject.** When evidence is missing or contradictory, the system surfaces `NEEDS_REVIEW` to a human officer instead of disqualifying a bidder.
2. **Every verdict is traceable.** Each `ELIGIBLE`/`NOT_ELIGIBLE` is tied to the specific clause, evidence snippet, and confidence score that produced it.
3. **The audit trail is immutable.** Officer overrides, criteria edits, and decisions are appended to a hash-chained audit log.

---

## What you get

| Capability | What's in the box |
|---|---|
| **Tender ingest** | Native PDF parsing → Tesseract by default; **PaddleOCR when installed** ([`ai-service/requirements-ocr.txt`](ai-service/requirements-ocr.txt)), per-page quality score, **Hindi via Tesseract `eng+hin` + optional Paddle Devanagari pass** |
| **Criteria extraction** | LLM-with-schema (Anthropic Claude) when configured; deterministic regex extractor covers ~16 categories: turnover, net worth, EMD, bank guarantee, experience, manpower, ISO 9001/14001/27001, NABL, GST/PAN/TDS, MSME/Udyam, bid validity, blacklisting |
| **Indic language pipeline** | Devanagari ratio language detector → pluggable translator (Bhashini ULCA / passthrough) → existing extractor. Each criterion carries `source_text_lang` and `source_clause_translated` so the audit trail keeps the original Hindi clause |
| **Decision engine** | Rule-based numeric thresholds + document-presence checks; confidence ≥ 0.7 `ELIGIBLE`/`NOT_ELIGIBLE` without an API key, `NEEDS_REVIEW` only on genuinely missing/conflicting evidence; optional LLM cross-check |
| **Sovereign mode** | `LLM_BACKEND=disabled\|bhashini\|anthropic\|groq` swaps the reasoning surface without rebuilding the image; deterministic mode runs zero foreign-cloud calls |
| **Officer UI** | Dashboard with pagination, tender workspace, **reasoning graph** (verdict-color-coded, click-to-detail, evidence chips, "Copy as JSON"), two-pane review queue with criterion-level overrides, audit log, in-app toasts, **EN ↔ हिं i18next toggle** persisted per officer |
| **Persistence** | Postgres-backed eval jobs survive restarts; partial unique index prevents duplicate runs per tender |
| **Auth** | JWT access + **refresh tokens** (DB-backed), `POST /auth/refresh` + logout, tunable `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL`; optional **`admin`** role for cross-tenant listing |
| **Demo pack** | **4** deterministic golden PDFs in `demo/pdfs/` (incl. Devanagari `04_TENDER_BHARAT_HINDI.pdf`), throughput benchmark (`benchmark.py`), reusable eval-payload fixture, 2-minute pitch script |

> **Bharat-first?** See [`docs/BHARAT_READINESS.md`](docs/BHARAT_READINESS.md) for the full sovereignty / Indic / MeitY-alignment story.

### Demo media and public URL (submission polish)

There is **no hosted demo by default** (sovereign / self-hosted mode). Use **[`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md)** for Fly.io / MinIO / env wiring, then paste your **live URL** here.

**Screenshots / video:** add files under [`docs/screenshots/`](docs/screenshots/) (see [`docs/screenshots/README.md`](docs/screenshots/README.md)) — e.g. `dashboard.png`, `reasoning-graph.png`, `review-queue.png` — then link them below before judging:

- Dashboard: _add link_
- Reasoning graph: _add link_
- Review queue: _add link_
- Optional Loom / mp4: _add link_

---

## Try it in 60 seconds (Docker)

```bash
git clone https://github.com/bansalbhunesh/tendersense-ai.git
cd tendersense-ai
cp .env.example .env             # set JWT_SECRET (>= 32 chars), keep ANTHROPIC_API_KEY blank for offline mode
docker compose up --build        # backend :8080  •  ai-service :8081  •  postgres :5432  •  redis :6379

# In another shell — frontend dev server:
cd frontend && npm install && npm run dev   # http://localhost:5173
```

Open `http://localhost:5173`, register an officer account, upload one of the PDFs in `demo/pdfs/`, register two bidders, run the evaluation, and watch the reasoning graph light up.

> Without `ANTHROPIC_API_KEY`, the deterministic engine still produces real `ELIGIBLE`/`NOT_ELIGIBLE` verdicts on the demo PDFs — no degraded "all NEEDS_REVIEW" experience.

### Common workflows via Make

```bash
make help            # list every target with one-line descriptions
make install         # install per-service deps (Python venv, npm, go modules)
make test            # run all four test suites (backend, ai-service, frontend, e2e)
make bench           # spin up ai-service in sovereign mode and run the throughput benchmark
make demo            # regenerate + verify the four deterministic demo PDFs
make smoke-bharat    # curl-based end-to-end smoke for /v1/detect-language, /translate, /evaluate
```

### Measured throughput (sovereign mode)

`make bench` against the deterministic engine on Apple Silicon (single uvicorn worker):

| Workload | Throughput | p50 | p95 |
|---|---|---|---|
| 50 req @ 10 concurrent | **1,138 req/s** | 7.5 ms | 20 ms |
| 200 req @ 25 concurrent | **1,171 req/s** | 13 ms | 57 ms |
| 500 req @ 50 concurrent | **1,986 req/s** | 22 ms | 33 ms |

This measures the rule-engine + JSON serialisation hot path. End-to-end tender ingestion adds OCR (~hundreds of ms per page) on top.

---

## Architecture

```
                              ┌──────────────────────────┐
                              │  Frontend (Vite + React) │
                              │  React Router • Toasts   │
                              │  Reasoning graph (SVG)   │
                              └──────────────┬───────────┘
                                             │ HTTPS + JWT
                              ┌──────────────▼───────────┐
                              │ Backend (Go / Gin)       │
                              │ • Auth, RBAC, rate-limit │
                              │ • Tender / bidder CRUD   │      ┌─────────────┐
                              │ • Eval orchestration ────┼─────►│ Postgres    │
                              │ • Audit log + reviews    │      │ + eval_jobs │
                              └──────────────┬───────────┘      └─────────────┘
                                             │ HTTP (internal)
                              ┌──────────────▼───────────┐      ┌─────────────┐
                              │ AI service (FastAPI)     │      │ Redis (opt) │
                              │ • OCR pipeline           ├─────►│ cache layer │
                              │ • Criteria extractor     │      └─────────────┘
                              │ • Decision engine        │
                              └──────────────┬───────────┘
                                             │ optional
                              ┌──────────────▼───────────┐
                              │ Anthropic Claude (LLM)   │
                              │  cross-check augmentation│
                              └──────────────────────────┘
```

**Three services, one repo.** No multi-repo coordination; each service has its own Dockerfile and tests.

---

## Repository layout

```
.
├── backend/         Go 1.22 • Gin • PostgreSQL migrations • JWT auth • 44 tests
├── ai-service/      FastAPI • OCR (pdfplumber/Tesseract) • criteria + decision engine • 45 tests
├── frontend/        Vite • React 18 • TS strict • Toasts • Reasoning graph • 29 unit tests + Playwright e2e
├── demo/            generate_demo_pdfs.py • 4 prebuilt PDFs • 2-minute live demo script
├── docs/            CRPF Round 1 written submission • observability notes
├── docker-compose.yml
└── .github/workflows/ci.yml   4-job CI matrix
```

---

## Test matrix

| Suite | Command | Count |
|---|---|---|
| Backend unit + handler (incl. PII redactor) | `cd backend && go test ./...` | **61 pass** |
| AI service (incl. translation, language detect, Hindi extraction, PII redactor) | `cd ai-service && pytest -q` | **90 pass / 1 skip** (Tesseract-only path) |
| Frontend unit (incl. i18n + reasoning graph) | `cd frontend && npm test` | **38 pass** |
| Playwright e2e (register → tender → eval) | `cd frontend && npm run test:e2e` | 1 smoke |

Every PR runs all four jobs in `.github/workflows/ci.yml`.

---

## API surface (selected)

| Method | Path | Notes |
|---|---|---|
| `POST` | `/api/v1/auth/register`, `/auth/login` | JWT bearer; rate-limited |
| `GET`/`POST` | `/api/v1/tenders` | `?limit=&offset=`, `X-Total-Count` header |
| `POST` | `/api/v1/tenders/:id/documents` | Upload tender PDF |
| `POST` | `/api/v1/tenders/:id/bidders` | Register bidder |
| `POST` | `/api/v1/tenders/:id/evaluate` | Trigger async evaluation; returns `job_id` |
| `GET` | `/api/v1/tenders/:id/evaluate/jobs/:job` | Poll job status (DB-backed; survives restart) |
| `GET` | `/api/v1/tenders/:id/results` | Verdicts + graph; decisions paginated (`?limit`/`?offset`, max 200) with `pagination` + `X-Total-Count` |
| `GET`/`POST` | `/api/v1/review/queue`, `/review/override` | Officer review workflow |
| `GET` | `/api/v1/audit` | Append-only audit log |
| `GET` | `/api/v1/version` | `{ version, commit }` |

**Error shape (4xx/5xx):** `{ "error": { "code": "bad_request", "message": "...", "request_id": "..." } }`

---

## Configuration

| Variable | Service | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | Backend | — | Postgres DSN (e.g. Render injects this for the live API) |
| `TEST_DATABASE_URL` | Backend (tests only) | _empty_ | **Not used on Render at runtime.** Set only when running `go test -tags=integration` locally/CI against a **disposable** Postgres; integration tests ignore `DATABASE_URL` on purpose so they never hit prod by accident. |
| `JWT_SECRET` | Backend | — | **Required.** ≥ 32 chars (warns below) |
| `JWT_ACCESS_TTL` | Backend | `15m` | Access JWT lifetime (max 168h). Shorter = smaller XSS window for bearer tokens. |
| `REFRESH_COOKIE_SAMESITE` / `REFRESH_COOKIE_SECURE` | Backend | Lax / auto | Use `REFRESH_COOKIE_SAMESITE=none` and HTTPS when the **SPA origin ≠ API origin** (cross-site fetch needs `SameSite=None; Secure`). |
| `REQUIRE_REDIS` | Backend | _unset_ | With `GIN_MODE=release` and `REQUIRE_REDIS=true`, process exits unless `REDIS_URL` is valid (cluster-wide eval rate limits). |
| `ALLOWED_ORIGINS` | Backend, AI | — | CSV list of allowed CORS origins |
| `ALLOWED_ORIGIN_REGEX` | Backend | _empty_ | Optional regex allowlist for dynamic preview URLs |
| `AI_SERVICE_URL` | Backend | `http://localhost:8081` | AI service base URL |
| `DATA_DIR` | Backend, AI | `data/uploads` | Shared upload root (path-traversal-locked in AI service) |
| `RESEND_API_KEY` | Backend | _empty_ | API key for password-reset email delivery |
| `RESET_EMAIL_FROM` | Backend | _empty_ | Sender identity for password-reset emails |
| `APP_BASE_URL` | Backend | _empty_ | Public frontend base URL used in reset links |
| `ALLOW_INSECURE_RESET_TOKEN_RESPONSE` | Backend | `false` | Dev-only: return reset token in API response when email fails |
| `ANTHROPIC_API_KEY` | AI | _empty_ | Required when `LLM_BACKEND=anthropic`; optional otherwise |
| `GROQ_API_KEY` | AI | _empty_ | Required when `LLM_BACKEND=groq` |
| `GROQ_MODEL` | AI | `llama-3.3-70b-versatile` | Groq model override |
| `ANTHROPIC_MODEL` | AI | `claude-sonnet-4-20250514` | Override the cross-check model |
| `LLM_BACKEND` | AI | `anthropic` | `anthropic` / `groq` / `disabled` / `bhashini` — sovereign-mode switch |
| `TRANSLATION_BACKEND` | AI | `disabled` | `disabled` (passthrough) / `bhashini` (ULCA pipeline) |
| `BHASHINI_USER_ID`, `BHASHINI_API_KEY`, `BHASHINI_PIPELINE_ID`, `BHASHINI_INFERENCE_URL` | AI | _empty_ | Required when `TRANSLATION_BACKEND=bhashini` |
| `OCR_LANGS` | AI | `eng` | Tesseract language stack. Set to `eng+hin` to enable Hindi OCR + a Devanagari PaddleOCR pass |
| `REDIS_URL` | Backend, AI | _empty_ | Backend: optional cluster-wide eval rate limits; AI: OCR/criteria cache. |
| `EVALUATE_CACHE_TTL_SECONDS` | AI | `900` | Eval result cache TTL |
| `MAX_JSON_BODY_BYTES` | AI | `33554432` (32 MiB) | Rejects JSON POST/PUT bodies larger than this when `Content-Length` is set (DoS guard). |
| `GIT_SHA` | Both | _empty_ | Surfaced via `/version` endpoints |
| `VITE_DEMO_EMAIL`, `VITE_DEMO_PASSWORD` | Frontend (dev only) | _empty_ | Populates a "Fill demo creds" button in dev builds; never committed |

Local dev env files: `backend/.env.example` and root `.env.example` (for compose).

---

## Local development (per service)

### Postgres
```bash
docker compose up -d db
# default DSN: postgres://tendersense:tendersense@localhost:5432/tendersense?sslmode=disable
```

### AI service (`:8081`)
```bash
cd ai-service
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt -r requirements-dev.txt
DATA_DIR=$(pwd)/data ALLOWED_ORIGINS='*' uvicorn main:app --reload --port 8081
```
> Note: pinned `pydantic-core` requires Python ≤ 3.12. Use `python3.12` for the venv.

### Backend (`:8080`)
```bash
cd backend
cp .env.example .env   # set JWT_SECRET
go run .
```

### Frontend (`:5173`)
```bash
cd frontend
npm install
npm run dev    # Vite proxies /api → http://127.0.0.1:8080
```

---

## Demo walkthrough

The 2-minute live pitch is scripted in [`demo/DEMO_SCRIPT.md`](demo/DEMO_SCRIPT.md). Key beats:

1. **Upload `01_TENDER_CRPF_DEMO.pdf`** → criteria populate (turnover ≥ ₹5 Cr, similar projects ≥ 3, GST mandatory, ISO optional, …).
2. **Bidder A** uploads `02_BIDDER_ACME_ELIGIBLE.pdf` → all green `ELIGIBLE`.
3. **Bidder B** uploads `03_BIDDER_BETA_CONFLICT.pdf` → **NEEDS_REVIEW** with `CONFLICT_DETECTED` (turnover appears as both ₹5.23 Cr and ₹3.10 Cr in the same pack).
4. Open the **reasoning graph** → click any node to see the evidence snippet + confidence.
5. Open the **review queue** → officer overrides Bidder B's verdict; the **audit log** gets a new immutable row with the previous and new state.

Regenerate PDFs:
```bash
cd demo && pip install -r requirements.txt && python generate_demo_pdfs.py && python verify_demo_pdfs.py
```

---

## Verdict states

| State | When | Confidence |
|---|---|---|
| **`ELIGIBLE`** | Numeric threshold met or required document present | ≥ 0.7 |
| **`NOT_ELIGIBLE`** | Numeric threshold violated or required document absent | ≥ 0.7 |
| **`NEEDS_REVIEW`** | Evidence absent / contradictory / OCR confidence too low | < 0.6 or conflict flag |

**Confidence < 0.6 always routes to a human.** That's the contract.

---

## Security posture

- JWT signed with HS256; `JWT_SECRET` length validated at boot.
- Rate limiting on `/auth/*` and `/evaluate`.
- Path-traversal protection on all file ops (`../../etc/passwd`-style inputs return 403).
- `ALLOWED_ORIGINS` enforced — wildcard CORS will not start the backend.
- bcrypt for passwords; structured error envelope avoids leaking internals.
- No demo credentials in source — only via `VITE_DEMO_*` in dev.
- **PII redaction at the log + audit boundary** — PAN / Aadhaar (Verhoeff-validated) / GSTIN are masked before any log emission and before `audit_log.payload` is persisted. Implemented symmetrically in both services (`backend/internal/util/pii/`, `ai-service/app/pii.py`) so the seam is the same regardless of which service emitted the record.

---

## Roadmap (honest list)

**What's already shipped in this repo (was on the roadmap in the previous draft):**

- 🇮🇳 **Indic tender ingest** — Devanagari OCR (`eng+hin`), Bhashini-pluggable translator, EN/हिं officer UI. See [`docs/BHARAT_READINESS.md`](docs/BHARAT_READINESS.md).
- 🛡️ **Sovereign mode** — `LLM_BACKEND=disabled` runs the deterministic engine with zero foreign-cloud calls.
- 📊 **Throughput harness** — `demo/benchmark.py` measures p50/p95/p99 against `/v1/evaluate`.
- 🧾 **PII redaction** — deterministic PAN / Aadhaar / GSTIN masking applied to every log emission and the `audit_log.payload` JSON, in both Go and Python services. Aadhaar matches are gated on the Verhoeff checksum to avoid redacting unrelated 12-digit numbers (turnover figures, transaction refs). Operational data paths (`decisions`, `documents.ocr_payload`) keep originals so officers still see evidence chips.

**Production-readiness gaps that still matter for an actual government deployment:**

- 🧠 **Domain-tuned reasoning** — replace the generic Claude cross-check with an IndicTrans2/AI4Bharat model fine-tuned on a real Indian tender corpus.
- 🚀 **Horizontal scale-out** — move eval execution to a Kafka/NATS worker pool; in-process today.
- 🔐 **Granular RBAC** — tender-scoped roles (creator / reviewer / auditor); all officers see everything today.
- 📦 **Object storage** — S3/MinIO with presigned URLs; uploads currently sit on a shared volume.
- 📊 **Metrics + tracing** — Prometheus + OpenTelemetry; logs only today.
- 📱 **Mobile-friendly UI** — field officers need it; current layout assumes desktop.
- 🔌 **GeM / CPPP connector** — direct tender ingest from gem.gov.in once empanelment is in place.

---

## License

MIT. See [LICENSE](LICENSE) if/when added.

## Acknowledgements

Built for the **AI for Bharat** hackathon — Round 1 written submission for the CRPF tender-evaluation challenge is in [`docs/CRPF_ROUND1_SUBMISSION.md`](docs/CRPF_ROUND1_SUBMISSION.md).
