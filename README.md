# TenderSense AI

> Explainable, auditable AI for **government tender evaluation** — built for Indian procurement realities (CRPF reference deployment).

[![CI](https://github.com/bansalbhunesh/tendersense-ai/actions/workflows/ci.yml/badge.svg)](https://github.com/bansalbhunesh/tendersense-ai/actions/workflows/ci.yml)
![tests](https://img.shields.io/badge/tests-118%20passing-brightgreen)
![go](https://img.shields.io/badge/backend-Go%201.22-00ADD8)
![python](https://img.shields.io/badge/ai--service-FastAPI%20%7C%20Python%203.12-3776AB)
![web](https://img.shields.io/badge/frontend-Vite%20%7C%20React%2018%20%7C%20TS%20strict-646CFF)
![license](https://img.shields.io/badge/license-MIT-blue)

```
Tender PDF ─► OCR + Native parse ─► Structured criteria  ─┐
                                                          ├─► Decision engine ─► PASS / FAIL / NEEDS_REVIEW
Bidder docs ─► OCR + Evidence extract ─► Normalized facts ┘                            │  (with confidence + reasoning)
                                                                                       ▼
                                                                 Officer review queue • Audit log • Reasoning graph
```

---

## Why this matters

Indian government procurement runs on long PDFs and inconsistent evidence. Today, eligibility is decided manually — slow, hard to audit, and prone to silent error. Existing automation tools either keyword-match (brittle) or hand the decision to a black-box LLM (unauditable).

**TenderSense AI is built around three commitments:**

1. **Never silently reject.** When evidence is missing or contradictory, the system surfaces `NEEDS_REVIEW` to a human officer instead of disqualifying a bidder.
2. **Every verdict is traceable.** Each PASS/FAIL is tied to the specific clause, evidence snippet, and confidence score that produced it.
3. **The audit trail is immutable.** Officer overrides, criteria edits, and decisions are appended to a hash-chained audit log.

---

## What you get

| Capability | What's in the box |
|---|---|
| **Tender ingest** | Native PDF parsing → Tesseract/PaddleOCR fallback, per-page quality score |
| **Criteria extraction** | LLM-with-schema (Anthropic Claude) when configured; deterministic regex extractor covers ~16 categories: turnover, net worth, EMD, bank guarantee, experience, manpower, ISO 9001/14001/27001, NABL, GST/PAN/TDS, MSME/Udyam, bid validity, blacklisting |
| **Decision engine** | Rule-based numeric thresholds + document-presence checks; confidence ≥ 0.7 PASS/FAIL without an API key, `NEEDS_REVIEW` only on genuinely missing/conflicting evidence; optional LLM cross-check |
| **Officer UI** | Dashboard with pagination, tender workspace, **reasoning graph** (verdict-color-coded, click-to-detail), two-pane review queue with criterion-level overrides, audit log, in-app toasts |
| **Persistence** | Postgres-backed eval jobs survive restarts; partial unique index prevents duplicate runs per tender |
| **Auth** | JWT + bcrypt, rate-limited login/eval, structured error envelope |
| **Demo pack** | 3 deterministic golden PDFs in `demo/pdfs/` + repeatable 2-minute pitch script |

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

> Without `ANTHROPIC_API_KEY`, the deterministic engine still produces real `PASS`/`FAIL` verdicts on the demo PDFs — no degraded "all NEEDS_REVIEW" experience.

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
├── demo/            generate_demo_pdfs.py • 3 prebuilt PDFs • 2-minute live demo script
├── docs/            CRPF Round 1 written submission • observability notes
├── docker-compose.yml
└── .github/workflows/ci.yml   4-job CI matrix
```

---

## Test matrix

| Suite | Command | Count |
|---|---|---|
| Backend unit + handler | `cd backend && go test ./...` | **44 pass** |
| AI service | `cd ai-service && pytest -q` | **45 pass / 1 skip** (Tesseract-only path) |
| Frontend unit | `cd frontend && npm test` | **29 pass** |
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
| `GET` | `/api/v1/tenders/:id/results` | Per-bidder verdicts + reasoning |
| `GET`/`POST` | `/api/v1/review/queue`, `/review/override` | Officer review workflow |
| `GET` | `/api/v1/audit` | Append-only audit log |
| `GET` | `/api/v1/version` | `{ version, commit }` |

**Error shape (4xx/5xx):** `{ "error": { "code": "bad_request", "message": "...", "request_id": "..." } }`

---

## Configuration

| Variable | Service | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | Backend | — | Postgres DSN |
| `JWT_SECRET` | Backend | — | **Required.** ≥ 32 chars (warns below) |
| `ALLOWED_ORIGINS` | Backend, AI | — | CSV list of allowed CORS origins |
| `AI_SERVICE_URL` | Backend | `http://localhost:8081` | AI service base URL |
| `DATA_DIR` | Backend, AI | `data/uploads` | Shared upload root (path-traversal-locked in AI service) |
| `ANTHROPIC_API_KEY` | AI | _empty_ | Optional. Without it, deterministic engine runs |
| `ANTHROPIC_MODEL` | AI | `claude-sonnet-4-20250514` | Override the cross-check model |
| `REDIS_URL` | AI | _empty_ | Optional cache; silent no-op when unset |
| `EVALUATE_CACHE_TTL_SECONDS` | AI | `900` | Eval result cache TTL |
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
2. **Bidder A** uploads `02_BIDDER_ACME_ELIGIBLE.pdf` → all green PASS.
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
| **`PASS`** | Numeric threshold met or required document present | ≥ 0.7 |
| **`FAIL`** | Numeric threshold violated or required document absent | ≥ 0.7 |
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

---

## Roadmap (honest list)

**Production-readiness gaps that ship-blocked us for a hackathon submission but matter for actual deployment:**

- 🇮🇳 **Indic-language tenders.** Today the extractor is English-only. Hindi + regional language support via Bhashini / IndicTrans2 / IndicBERT is the next high-impact unlock.
- 🧠 **Domain-tuned model.** Replace generic Claude cross-check with a model fine-tuned on a curated Indian tender corpus.
- 📈 **Throughput.** Single-process eval works for demo scale; production needs a worker queue (NATS/Kafka) and horizontal eval workers.
- 🔐 **RBAC.** Today a logged-in officer sees everything. Add tender-scoped roles (creator / reviewer / auditor).
- 📦 **Object storage.** Uploads are on shared volume; S3/MinIO with presigned URLs for production.
- 📊 **Metrics + tracing.** Logs only today. Prometheus + OpenTelemetry traces + dashboards.
- 📱 **Mobile-friendly UI.** Officers in the field need it.
- 🧾 **PII redaction.** Bidder docs contain PAN/Aadhaar — needs deterministic redaction before logging.

---

## License

MIT. See [LICENSE](LICENSE) if/when added.

## Acknowledgements

Built for the **AI for Bharat** hackathon — Round 1 written submission for the CRPF tender-evaluation challenge is in [`docs/CRPF_ROUND1_SUBMISSION.md`](docs/CRPF_ROUND1_SUBMISSION.md).
