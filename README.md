# TenderSense AI

Hackathon stack for **AI-based tender evaluation** with explainability, confidence propagation, cross-document checks, and an immutable audit trail.

## Layout

- `backend/` — Go (Gin) REST API, PostgreSQL, JWT auth, calls the AI worker over HTTP.
- `ai-service/` — FastAPI: OCR pipeline (pdfplumber → PaddleOCR / Tesseract), criteria extraction (Claude or heuristic fallback), decision engine.
- `frontend/` — Vite + React officer UI: tender workspace, reasoning graph, review queue.
- `docs/` — **Round 1 written submission** for CRPF-style evaluation (`CRPF_ROUND1_SUBMISSION.md`).
- `demo/` — **Golden demo PDFs** + generator script and live pitch script (`DEMO_SCRIPT.md`).

## Round 1 document + demo pack

- **Written submission (rubric-aligned):** [docs/CRPF_ROUND1_SUBMISSION.md](docs/CRPF_ROUND1_SUBMISSION.md)
- **Generate three fixed PDFs:**

  ```bash
  cd demo
  pip install -r requirements.txt
  python generate_demo_pdfs.py
  ```

  Outputs go to `demo/pdfs/` (`01_TENDER_…`, `02_BIDDER_…`, `03_BIDDER_…`).

- **Sanity-check extracted text:** `python demo/verify_demo_pdfs.py` (requires `demo/requirements.txt`).

- **Step-by-step live demo:** [demo/DEMO_SCRIPT.md](demo/DEMO_SCRIPT.md)

## Local development

1. **PostgreSQL** — create DB `tendersense` or use Docker only for DB:

   ```bash
   docker compose up -d db
   ```

2. **AI service** (port 8081):

   ```bash
   cd ai-service
   python -m venv .venv
   source .venv/bin/activate  # Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   # Optional: export ANTHROPIC_API_KEY=... for LLM criteria extraction
   uvicorn main:app --reload --port 8081
   ```

3. **Backend** (port 8080):

   ```bash
   cd backend
   cp .env.example .env
   go run .
   ```

4. **Frontend** (port 5173):

   ```bash
   cd frontend
   npm install
   npm run dev
   ```

   The Vite dev server proxies `/api` to `http://127.0.0.1:8080`.

## Docker (API + AI + Postgres)

```bash
docker compose up --build
```

Note: the frontend is not in Compose by default; run it locally with `npm run dev` or add a Node image if needed.

## Demo tips

- Use 2–3 curated PDFs or PNGs you have tested; avoid live general-case OCR in judging.
- Show: conflict → NEEDS_REVIEW, reasoning graph, reviewer override → audit checksum.

## Pitch line

Government tender evaluation today produces outcomes that cannot be explained and cannot be audited. TenderSense AI does not only automate the decision — it automates the justification.
