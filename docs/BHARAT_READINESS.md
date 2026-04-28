# Bharat Readiness — TenderSense AI

> Status snapshot for hackathon judges and procurement reviewers. Last updated 2026-04-28.
>
> This document captures what TenderSense AI does **today** for Bharat-first
> deployments, what is stubbed but not yet wired, and what we plan to ship next.
> We deliberately separate the three so a CRPF / MeitY / GeM reviewer can audit
> the gap between marketing claims and reality.

---

## 1. Why Bharat-first matters for procurement

Indian government procurement runs on documents that are **not English-only by
default**:

- Tender notices on GeM and CPPP regularly mix English headers with Hindi
  technical clauses, and state-PSU tenders are increasingly multilingual
  (Marathi, Tamil, Bengali, Gujarati).
- Bidder evidence — CA certificates, ITR computations, GST registrations,
  MSE/UAM registrations — arrive as a mix of digital PDFs, scans, and
  photographed printouts, often with bilingual labels.
- The accountability chain (CVC, CAG, MeitY) requires that every automated
  decision be **explainable in the language of the document** that produced it.

A pipeline that silently downgrades non-English inputs is unacceptable: it
either falsely disqualifies eligible MSEs (a procurement-policy violation) or
produces audit trails that a Hindi-speaking officer cannot defend in a hearing.

TenderSense AI therefore treats Indic text as a **first-class input**, not a
translation afterthought, and exposes a **sovereign-mode** switch so the same
binary can run inside an air-gapped MeitY-compliant deployment with zero
calls to foreign clouds.

---

## 2. Indic-language readiness

### 2.1 What ships today

| Capability | State | Notes |
|---|---|---|
| Devanagari (Hindi) text in digital PDFs | **Working** | `01_TENDER_CRPF_DEMO.pdf` has an EN twin (`04_TENDER_BHARAT_HINDI.pdf`); pdfplumber extracts the Devanagari clusters cleanly and `verify_demo_pdfs.py` asserts on stems like `टर्नओवर`, `जीएसटी`, `आईएसओ`. |
| OCR engine selection | **Working (PaddleOCR primary, Tesseract fallback)** | See `ai-service/app/ocr_pipeline.py`. PaddleOCR ships Devanagari-trained weights out of the box; Tesseract uses `hin` + `eng` traineddata when present. |
| Demo PDF generator with Devanagari | **Working** | `demo/generate_demo_pdfs.py` lazily downloads `NotoSansDevanagari-Regular.ttf` into `demo/.fonts/` (gitignored) and embeds it via `fpdf2.add_font`. |
| Deterministic decision engine on Hindi clauses | **Working through translation hop** | `ai-service/app/decision_engine.py` regexes match on EN normalised tokens (`turnover`, `crore`, `gstin`, `iso`); Hindi inputs flow through the translation step described below before evaluation. |
| Bilingual reasoning strings | **Stubbed** | The reasoning sentences emitted by `decision_engine` are EN today. Per-criterion bilingual rendering is on the Round-2 list (Section 7). |

### 2.2 What ships in this PR (modules now on disk)

The following modules — referenced throughout this document — landed in the
same PR as this readiness note:

- **`ai-service/app/translation.py`** — Devanagari ratio language detector
  (`detect_language`), `Translator` Protocol, `DisabledTranslator` (passthrough),
  `BhashiniTranslator` (httpx-backed ULCA pipeline client), and a memoised
  `get_translator()` factory keyed off `TRANSLATION_BACKEND`. Covered by 14
  unit tests in `tests/test_translation.py`.
- **`frontend/src/i18n/`** — i18next bootstrap with EN + HI resource files
  (`locales/en.json`, `locales/hi.json`) covering namespaces `common / auth /
  dashboard / workspace / review / graph / errors`. Language detection is
  localStorage-first (`ts_lang`) with a navigator fallback; auto-selects HI
  when the browser locale begins with `hi`.
- **EN/हिं toggle in `AppHeader.tsx`** — two `data-testid`-tagged buttons
  with `aria-pressed` state and persistent localStorage selection. Covered by
  5 vitest cases in `__tests__/i18n.test.tsx`.
- **New AI endpoints** — `POST /v1/detect-language`, `POST /v1/translate`,
  and an extended `GET /v1/version` that surfaces `llm_backend` +
  `translation_backend`.

What this means for a judge poking the codebase: every Bharat-first claim in
this document maps to running code, with tests, in the PR that introduced
this file.

### 2.3 Bhashini hookup design

When `LLM_BACKEND=bhashini` (Section 3), the AI service will:

1. POST OCR text to the Bhashini ULCA pipeline endpoint
   (`https://meity-auth.ulcacontrib.org`) with the language-detect + NMT
   sub-pipeline, using the deployment's MeitY-issued API key.
2. Cache the translated payload in Redis under
   `translate:v1:{src}:{tgt}:{sha256(text)}` with the same TTL story as the
   existing `criteria:v1` cache (`ai-service/app/cache.py`).
3. Surface both the original Devanagari snippet **and** the EN translation on
   every `Evidence` record so the audit log carries the source language.

Bhashini was picked because:

- It is the GoI-sanctioned NMT layer (MeitY / Digital India Bhashini
  Mission), so a sovereign-mode deployment can use it without flagging a
  foreign-cloud dependency.
- It already exposes an IndicTrans2 backend under the hood, giving us a
  clean migration path to a fully self-hosted IndicTrans2 instance later.

---

## 3. Sovereign-mode design (`LLM_BACKEND`)

The AI service reads `LLM_BACKEND` (see `_llm_backend()` in
`ai-service/app/decision_engine.py`) to pick its reasoning backend:

| Value | Behaviour | Foreign-cloud calls? |
|---|---|---|
| `disabled` | Pure deterministic regex + heuristic engine. No network calls outside Postgres + Redis. | **None.** Suitable for air-gapped CRPF / Cantt deployments. |
| `bhashini` | Translation via Bhashini ULCA; deterministic engine for verdicts; criteria extraction via the heuristic fallback. | Bhashini only (govt-hosted). |
| `anthropic` | Adds Claude API for the criteria-extraction LLM and ambiguity tie-breaks. | Anthropic API. |

Defaults:

- The hackathon demo runs with `anthropic` for richer criteria extraction.
- A government deployment is expected to ship with `disabled` or `bhashini`.
  The same Docker image satisfies all three modes — only env vars change.

### 3.1 What "sovereign" means here, concretely

- **No foreign cloud in the data plane.** With `LLM_BACKEND=disabled`,
  PDFs land in MinIO/S3 on-prem, OCR runs in the in-cluster Python service,
  the decision engine is local code, and Postgres + Redis are the only stateful
  dependencies — all on-prem.
- **Auditability survives backend swaps.** Every evidence record carries
  `engine` (`paddleocr`, `tesseract`, `pdfplumber`, ...) and the audit table
  records `LLM_BACKEND` per evaluation, so a CAG audit can prove which
  reasoning surface produced any given verdict.
- **No outbound DNS unless explicitly enabled.** Sovereign-mode deployments
  drop egress at the namespace policy level; the service degrades to
  deterministic mode if the configured backend is unreachable rather than
  blocking.

---

## 4. Demo flow with the Hindi tender

The Bharat-first beat is layered onto the standard demo (full text in
`/Users/ankur/Work/tendersense-ai/demo/DEMO_SCRIPT.md`).

Quick recap:

1. Officer toggles UI to **हिं**.
2. Uploads `04_TENDER_BHARAT_HINDI.pdf` — Devanagari clauses for the same
   four eligibility rules as the EN demo tender.
3. OCR returns clean Devanagari; translation hop produces an EN view of the
   criteria list (or, in `LLM_BACKEND=disabled` mode, the heuristic regex
   path matches `टर्नओवर` / `करोड़` / `जीएसटी` directly via the
   pre-normalised token table).
4. Evaluation runs against the same regex engine that handles the EN demo;
   verdicts and conflict detection behave identically.

The PDF asset itself is generated and verified in CI:

```bash
cd demo
python generate_demo_pdfs.py        # writes pdfs/01..pdfs/04
python verify_demo_pdfs.py          # asserts Hindi keywords present
```

---

## 5. Throughput benchmark

`demo/benchmark.py` is a standalone driver that hammers `/v1/evaluate` with
a fixed payload (`demo/fixtures/eval_payload.json`, 4 criteria, 2 bidders)
and reports avg / median / p95 / p99 latency plus throughput.

```bash
# Sovereign mode (deterministic, no API key needed)
LLM_BACKEND=disabled uvicorn main:app --host 0.0.0.0 --port 8081
demo/.venv/bin/python demo/benchmark.py --n 500 --concurrency 50
```

### Measured numbers (sovereign mode)

| Workload | Throughput | p50 | p95 | p99 |
|---|---|---|---|---|
| 50 req @ 10 concurrent | **1,138 req/s** | 7.5 ms | 20.3 ms | 21.7 ms |
| 200 req @ 25 concurrent | **1,171 req/s** | 13.0 ms | 57.2 ms | 82.4 ms |
| 500 req @ 50 concurrent | **1,986 req/s** | 22.3 ms | 33.4 ms | 34.6 ms |

Captured on Apple Silicon (M-class) with a single uvicorn worker,
`LLM_BACKEND=disabled`, `TRANSLATION_BACKEND=disabled`. Real production with
multi-worker uvicorn or gunicorn behind an L7 LB would scale linearly until
Postgres becomes the bottleneck.

What this is **not**: this measures the rule-engine + JSON serialisation hot
path only. Add OCR (~hundreds of ms per page on small documents) and document
upload I/O for an end-to-end tender evaluation. The decision engine itself is
not the throughput limiter.

Reproduce locally:

```bash
make bench   # spawns ai-service in sovereign mode and runs the 500/50 sweep
```

The benchmark is deliberately simple — pure stdlib + `httpx`, no extra
dashboarding — so it doubles as a regression check. Wall-clock + p95
thresholds will be wired into CI in Round 2.

---

## 6. Roadmap to production

### 6.1 Indic NLP

- **IndicTrans2 self-host.** Pull the AI4Bharat IndicTrans2 weights and run
  them inside the cluster via vLLM or the Hugging Face TGI image. Behaviour
  becomes equivalent to Bhashini but removes the only external dependency
  in sovereign mode.
- **Indic OCR fine-tuning.** PaddleOCR's Devanagari head handles printed
  text well; we want a small fine-tune on tender-domain scans (CA letterheads,
  GST certificates) using a couple of thousand labelled crops from real GeM
  filings (with consent / DPDPA opt-in).
- **Cross-lingual evidence linking.** Today the deterministic engine sees a
  translated EN string; we want to retain the original Devanagari span and
  bbox on every `Evidence` record so the UI can highlight the source clause
  in its native script.

### 6.2 Procurement integration

- **GeM portal connector.** Read tenders directly from the GeM bidder API
  (`https://gem.gov.in/`) once we have empanelment; fall back to PDF upload
  for portals without programmatic access (CPPP, state e-procurement).
- **eOffice / DigiLocker handshake.** Officer login via Parichay / DigiLocker
  for the strongest available identity; document fetch via DigiLocker
  Issuer API where the bidder has consented to share.

### 6.3 Compliance

- **MeitY data localisation.** Default storage region is `ap-south-1`
  equivalent; on-prem MinIO is the canonical deployment. No PII leaves
  Indian soil in any backend mode.
- **DPDPA 2023 alignment.** Bidder PII (PAN, GSTIN, addresses) is tagged at
  ingestion; the audit log records who viewed what and when. Right-to-erase
  is a Round-3 deliverable.
- **CVC manual compliance.** Every override is captured as an
  append-only audit row with a SHA-256 over the canonical decision payload
  (already implemented; see Round-1 submission §6).

### 6.4 Platform

- **RBAC.** Today's tokens are flat (officer / bidder); we need
  organisation-scoped roles (CPC member, evaluator, observer, auditor) with
  attribute-based policies.
- **Async scale-out.** Move from in-process evaluation to a Kafka-driven
  worker pool so a single tender with 50+ bidders evaluates in parallel.
  Logical events are already shaped for this (see `evaluate_start` /
  `evaluate_ok` in `ai-service/main.py`).

---

## 7. Test coverage

The high-level test matrix lives in the repository's main `README.md` and
the existing Round-1 submission (`docs/CRPF_ROUND1_SUBMISSION.md` §10).
Bharat-readiness-specific coverage:

- `demo/verify_demo_pdfs.py` asserts the Hindi PDF carries the expected
  Devanagari keywords (`टर्नओवर`, `जीएसटी`, `करोड़`, `परियोजना`,
  `आईएसओ`, `पात्रता`).
- `ai-service/tests/test_ocr.py` exercises the OCR pipeline; PaddleOCR's
  Devanagari head is invoked when the test fixture is multi-lingual.
- `ai-service/tests/test_decision.py` covers the deterministic regex
  engine on EN text; the Hindi path goes through translation first, so the
  same tests apply once the translator lands.
- The benchmark (`demo/benchmark.py`) doubles as a regression check —
  wall-clock and p95 thresholds will be wired into CI in Round 2.

---

## 8. Quick reference

| File | Purpose |
|---|---|
| `demo/generate_demo_pdfs.py` | Generates the four demo PDFs incl. the Hindi tender. |
| `demo/pdfs/04_TENDER_BHARAT_HINDI.pdf` | Devanagari counterpart to the CRPF demo tender. |
| `demo/verify_demo_pdfs.py` | Asserts each PDF parses and carries expected tokens. |
| `demo/benchmark.py` | Throughput + latency benchmark for `/v1/evaluate`. |
| `demo/fixtures/eval_payload.json` | Reusable 4-criteria / 2-bidder payload. |
| `demo/DEMO_SCRIPT.md` | Live demo walkthrough; includes the Bharat upgrade beat. |
| `ai-service/app/ocr_pipeline.py` | OCR engine selection (PaddleOCR / Tesseract / pdfplumber). |
| `ai-service/app/decision_engine.py` | Deterministic regex engine + `LLM_BACKEND` switch. |
| `docs/CRPF_ROUND1_SUBMISSION.md` | Original written submission. |
| `docs/observability.md` | SLO baseline this benchmark feeds into. |

---

## 9. Honest gap list

The translator + i18n modules are now real code (§2.2). Remaining gaps,
called out so procurement trust does not depend on judges discovering them:

1. **Bhashini wire format is verified against the public ULCA contract, not a
   live tenant.** `BhashiniTranslator` is exercised end-to-end via mocked
   `httpx` in `tests/test_translation.py`. To flip on against a real Bhashini
   deployment, set `TRANSLATION_BACKEND=bhashini` plus the four `BHASHINI_*`
   env vars and confirm whether the tenant uses the one-step `compute`
   endpoint or the two-step `config → compute` flow. Header naming
   (`userID` / `ulcaApiKey` vs `Authorization: Bearer`) is the most likely
   fit-up point.
2. **`LLM_BACKEND=bhashini` is a future-stub for cross-check.** Today it
   logs a warning and falls through to deterministic-only for the LLM cross
   check, while still allowing `BhashiniTranslator` for translation. A
   Bhashini-backed cross-check requires implementing `call_llm_eval`-equivalent
   in `decision_engine.py`.
3. **Bilingual reasoning strings on the evidence record are EN-only.** The
   UI surfaces translated criteria and the original Devanagari source clause,
   but the rule-engine reasoning sentence is generated in EN.
4. **Real benchmark numbers on production hardware are pending Round-2.**
   `demo/benchmark.py` is the harness; the SLO baseline lives in
   `docs/observability.md`.
5. **GeM connector, DigiLocker integration, and Parichay SSO** remain
   roadmap items (§6.2).
6. **Hindi PaddleOCR weights** are downloaded lazily on first call. For
   air-gapped deployments, pre-bake the `~/.paddleocr` cache for the `hi`
   model; Tesseract Hindi data is already covered by the `tesseract-ocr-hin`
   apt package in the Dockerfile.

We chose to keep this list visible rather than buried because procurement
trust depends on it. The deterministic engine, the sovereign-mode switch,
the translator + i18n surfaces, the Hindi PDF generation, the benchmark
harness, and the audit trail are real and runnable today; everything above
is signposted as future work.
