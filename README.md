# TenderSense AI

**AI-based tender evaluation and eligibility analysis** for government procurement — with explainable per-criterion verdicts, confidence propagation, cross-document consistency checks, human-in-the-loop review, and an immutable audit trail.

**Repository:** [github.com/bansalbhunesh/tendersense-ai](https://github.com/bansalbhunesh/tendersense-ai)

---

## What it does

- **Tender ingest** — Upload tender PDFs; extract text (native PDF + OCR fallback).
- **Criteria extraction** — Structured eligibility rules. LLM with schema when `ANTHROPIC_API_KEY` is set; otherwise the deterministic extractor recognises turnover, net worth, EMD, bank guarantee, experience, manpower, ISO 9001/14001/27001, NABL, GST/PAN/TDS, MSME/Udyam, bid validity, blacklisting/debarment.
- **Bidder evidence** — Parse bidder documents, normalize amounts and compliance signals.
- **Decision engine** — Rule-based evaluation with explicit confidence. Numeric thresholds and document-presence checks emit deterministic **`PASS`**/**`FAIL`** with confidence ≥ 0.7; **`NEEDS_REVIEW`** is reserved for genuinely missing or contradictory evidence. Optional LLM cross-check augments rather than gates.
- **Officer UI** — Dashboard with pagination, tender workspace, **reasoning graph** with verdict color-coding and click-to-detail, two-pane review queue with criterion-level overrides, audit log, in-app toast notifications.
- **Persistence** — Evaluation jobs are persisted in Postgres (`evaluation_jobs` table) and survive backend restarts; a partial unique index prevents duplicate concurrent runs per tender.
- **Demo pack** — Three golden PDFs + scripts under `demo/` for a repeatable live pitch.

## Tests

| Service | Suite | Count |
|---------|-------|-------|
| `backend/` | `go test ./...` | 44 unit/handler tests |
| `ai-service/` | `pytest` | 45 (1 skipped if Tesseract is absent) |
| `frontend/` | `vitest run` | 29 component/api tests |
| `frontend/e2e/` | Playwright | 1 end-to-end smoke |

CI runs all four suites on every PR (`.github/workflows/ci.yml`).

---

## Repository layout

| Path | Description |
|------|-------------|
| `backend/` | Go (Gin) REST API, PostgreSQL migrations, JWT auth; orchestrates evaluation via the AI service. |
| `ai-service/` | FastAPI: OCR (pdfplumber → PaddleOCR / Tesseract), criteria extraction, decision engine. |
| `frontend/` | Vite + React + TypeScript officer UI. |
| `docs/` | Round 1 written submission (`CRPF_ROUND1_SUBMISSION.md`). |
| `demo/` | PDF generator, **prebuilt PDFs** in `demo/pdfs/`, verification script, live demo script. |

This is a **monorepo** (one clone, three services). You do **not** need three separate Git repositories.

---

## Quick start (clone)

```bash
git clone https://github.com/bansalbhunesh/tendersense-ai.git
cd tendersense-ai
```

Then follow **Local development** below. Copy `backend/.env.example` to `backend/.env` and adjust `DATABASE_URL`, `JWT_SECRET`, and `AI_SERVICE_URL`.

---

## Round 1 document + demo PDFs

- **Written submission (problem, architecture, risks, Round 2 plan):** [docs/CRPF_ROUND1_SUBMISSION.md](docs/CRPF_ROUND1_SUBMISSION.md)
- **Regenerate demo PDFs (optional; committed copies already exist in `demo/pdfs/`):**

  ```bash
  cd demo
  pip install -r requirements.txt
  python generate_demo_pdfs.py
  python verify_demo_pdfs.py
  ```

- **Live pitch walkthrough:** [demo/DEMO_SCRIPT.md](demo/DEMO_SCRIPT.md)

---

## Local development

### 1. PostgreSQL

Create a database (or use Docker):

```bash
docker compose up -d db
```

Default URL used by the backend if unset:  
`postgres://tendersense:tendersense@localhost:5432/tendersense?sslmode=disable`

### 2. AI service (port 8081)

```bash
cd ai-service
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt
# Optional: export ANTHROPIC_API_KEY=...  # stronger criteria extraction
uvicorn main:app --reload --port 8081
```

### 3. Backend (port 8080)

```bash
cd backend
cp .env.example .env
go run .
```

### 4. Frontend (port 5173)

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server proxies `/api` to `http://127.0.0.1:8080`.

---

## Docker (API + AI + Postgres)

```bash
cp .env.example .env   # set JWT_SECRET (32+ chars) and ALLOWED_ORIGINS
docker compose up --build
```

The frontend is not included in Compose by default; run it locally with `npm run dev` in `frontend/`, or extend `docker-compose.yml` with a Node service if you prefer.

---

## Environment variables (summary)

| Variable | Service | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | Backend | PostgreSQL connection string |
| `JWT_SECRET` | Backend | Signing key for JWTs (32+ chars; warns below that) |
| `ALLOWED_ORIGINS` | Backend / AI | Comma-separated allowed CORS origins |
| `AI_SERVICE_URL` | Backend | Base URL of the Python service (e.g. `http://localhost:8081`) |
| `ANTHROPIC_API_KEY` | AI (optional) | Claude cross-check; deterministic engine works without it |
| `DATA_DIR` | Backend / AI | Shared upload directory (path-traversal-locked in AI service) |
| `REDIS_URL` | AI (optional) | OCR/criteria/evaluation cache; silent no-op when unset |
| `GIT_SHA` | Both (optional) | Surfaced via `GET /api/v1/version` and `/v1/version` |
| `VITE_DEMO_EMAIL`, `VITE_DEMO_PASSWORD` | Frontend (dev only) | Populates a "Fill demo creds" button on the auth page in dev builds; never committed |
| `PORT` | Backend / AI | Listen port (default 8080 / 8081) |

---

## Demo tips

- Prefer the **three PDFs** in `demo/pdfs/` for judging; avoid untested live OCR.
- Show: **conflict** → `NEEDS_REVIEW`, **reasoning graph**, **reviewer override** → **audit checksum**.

---

## Pitch line

Government tender evaluation today produces outcomes that cannot be explained and cannot be audited. TenderSense AI does not only automate the decision — it automates the justification.

---

## License

Specify your license here (e.g. MIT) if you publish one for the hackathon.
