# TenderSense AI

**AI-based tender evaluation and eligibility analysis** for government procurement — with explainable per-criterion verdicts, confidence propagation, cross-document consistency checks, human-in-the-loop review, and an immutable audit trail.

**Repository:** [github.com/bansalbhunesh/tendersense-ai](https://github.com/bansalbhunesh/tendersense-ai)

---

## What it does

- **Tender ingest** — Upload tender PDFs; extract text (native PDF + OCR fallback).
- **Criteria extraction** — Structured eligibility rules (LLM with schema when `ANTHROPIC_API_KEY` is set; deterministic fallback offline).
- **Bidder evidence** — Parse bidder documents, normalize amounts and compliance signals.
- **Decision engine** — Rule-based evaluation with explicit confidence; **`NEEDS_REVIEW`** instead of silent rejection when uncertain or conflicting.
- **Officer UI** — Dashboard, tender workspace, **reasoning graph**, review queue, audit log.
- **Demo pack** — Three golden PDFs + scripts under `demo/` for a repeatable live pitch.

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
docker compose up --build
```

The frontend is not included in Compose by default; run it locally with `npm run dev` in `frontend/`, or extend `docker-compose.yml` with a Node service if you prefer.

---

## Environment variables (summary)

| Variable | Service | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | Backend | PostgreSQL connection string |
| `JWT_SECRET` | Backend | Signing key for JWTs |
| `AI_SERVICE_URL` | Backend | Base URL of the Python service (e.g. `http://localhost:8081`) |
| `ANTHROPIC_API_KEY` | AI (optional) | Claude-based criteria extraction |
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
