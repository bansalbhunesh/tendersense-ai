# Observability and SLO Baseline

## Service Level Objectives

- Evaluation completion latency (P95): `< 120s` for 50 criteria x 5 bidders.
- OCR endpoint success rate: `>= 99.0%`.
- Evaluation endpoint/job success rate: `>= 98.5%`.
- Review queue freshness: new `NEEDS_REVIEW` item visible in `< 30s`.

## Required Log Events

- Backend:
  - `http_request` (request_id, path, method, status, latency_ms)
  - `evaluation.start`, `evaluation.success`, `evaluation.error`
  - upload failures for OCR/criteria extraction dependency calls
- AI service:
  - `process_document_start|ok|cache_hit`
  - `extract_criteria_start|ok|cache_hit`
  - `evaluate_start|ok|cache_hit`

## Alert Suggestions

- API 5xx rate > 2% for 5 minutes.
- Evaluation failed jobs > 5 in 15 minutes.
- OCR dependency failures > 10 in 10 minutes.
- Redis unavailable for > 5 minutes (cache disabled).

## Dashboard Dimensions

- Request rate and latency by endpoint.
- Job queue states: queued/running/completed/failed.
- AI cache hit rate by operation.
- `NEEDS_REVIEW` ratio per tender and over time.
