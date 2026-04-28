# Bhashini integration — operator's setup guide

This is the runbook for flipping `TRANSLATION_BACKEND=bhashini` on against a
real Bhashini deployment. The code path (`ai-service/app/translation.py`) is
exercised end-to-end by 14 unit tests against the **public ULCA contract**;
this guide closes the gap between that contract and a live tenant.

> Audience: a CRPF / MeitY / GeM operator who already has Bhashini ULCA
> credentials. If you don't yet have credentials, request access at
> [bhashini.gov.in](https://bhashini.gov.in/) → ULCA developer portal.

---

## 1. What you'll need

| Item | Where it comes from |
|---|---|
| `BHASHINI_USER_ID` | ULCA portal → **My Profile** → User ID |
| `BHASHINI_API_KEY` | ULCA portal → **API Keys** → generate / copy |
| `BHASHINI_PIPELINE_ID` | ULCA portal → **Pipelines** → pick a translation pipeline (one with NMT enabled, e.g. AI4Bharat IndicTrans2) → copy ID |
| `BHASHINI_INFERENCE_URL` | The inference endpoint shown in the pipeline detail. Sometimes different from the auth endpoint. |

---

## 2. Configure & run

```bash
cp .env.example .env
# Edit .env:
TRANSLATION_BACKEND=bhashini
BHASHINI_USER_ID=...
BHASHINI_API_KEY=...
BHASHINI_PIPELINE_ID=...
BHASHINI_INFERENCE_URL=https://meity-auth.ulcacontrib.org/...

# Bring the stack up (or restart ai-service alone):
docker compose up -d ai-service
```

Verify with the smoke script:

```bash
./demo/smoke_bharat.sh
# /v1/translate should return 200 (not 503) and surface a translated payload.
```

Or hit the endpoint directly:

```bash
curl -X POST http://localhost:8081/v1/translate \
  -H 'content-type: application/json' \
  -d '{"text":"बोलीदाता का न्यूनतम वार्षिक टर्नओवर रु. 5 करोड़ होना चाहिए।","src":"hi","tgt":"en"}'
```

---

## 3. Troubleshooting (common fit-up points)

The `BhashiniTranslator` we ship targets the public ULCA "Translation" task
contract. Different tenants and ULCA versions disagree on a few details; if
you see failures, check these in order:

### 3.1. Header naming

Some Bhashini deployments use:

```
userID:       <your user id>
ulcaApiKey:   <your api key>
```

Others use Bearer auth:

```
Authorization: Bearer <token>
```

Check the **Try it out** panel in the ULCA portal for your pipeline and match
the headers in `app/translation.py::BhashiniTranslator._build_request_headers`.

### 3.2. One-step vs two-step pipeline

The shipped client assumes a **one-step "compute"** call: post your text, get
a translation. Some pipelines require a **two-step config → compute** flow:

1. `POST /ulca/apis/asr-llm-nmt/v0/model/getModelsPipeline` with `pipelineRequestConfig` to get a `callbackUrl` + `inferenceApiKey`.
2. `POST <callbackUrl>` with the actual translation payload.

If your pipeline is two-step, add a `_resolve_pipeline_compute_url()` step
in `BhashiniTranslator.translate()` before the actual translation call. The
unit tests' fake httpx is structured so this won't break them — just monkey
patch both calls.

### 3.3. Request body shape

Current shape (matches the public docs at the time of writing):

```json
{
  "pipelineTasks": [
    {
      "taskType": "translation",
      "config": {
        "language": { "sourceLanguage": "hi", "targetLanguage": "en" }
      }
    }
  ],
  "inputData": { "input": [{ "source": "..." }] }
}
```

If the live tenant rejects this with `400`, check whether they expect
`serviceId` inside `config` or a `pipelineRequestConfig` wrapper.

### 3.4. Response shape

Current parser reads:

```json
{ "pipelineResponse": [ { "output": [ { "target": "translated text" } ] } ] }
```

Variant: some pipelines wrap responses in `output[0].outputText`. Adjust
`BhashiniTranslator._parse_response` accordingly.

---

## 4. Enabling the LLM cross-check via Bhashini

`LLM_BACKEND=bhashini` is wired but currently logs a warning and falls through
to deterministic-only for the LLM cross-check (translation still works). To
flip on the LLM cross-check:

1. Pick a Bhashini pipeline that exposes a chat / generation task (the
   AI4Bharat OpenHathi or BharatGPT pipelines if your tenant has them).
2. Add a `BhashiniLLMClient` analogous to the existing `_get_anthropic_client`
   in `ai-service/app/decision_engine.py`.
3. Route `_get_anthropic_client()` to the new client when
   `LLM_BACKEND == "bhashini"`.
4. Mirror the request shape used by Anthropic (system prompt + messages list)
   into whatever shape the Bhashini chat task expects.

The audit trail already records `llm_backend` per evaluation, so a CAG
auditor can prove which reasoning surface produced a given verdict.

---

## 5. Sovereign-mode escape hatch

If Bhashini is **down** or unreachable, the AI service degrades gracefully:

- `BhashiniTranslator` raises `RuntimeError` on connection failure → factory
  silently falls back to `DisabledTranslator`.
- Hindi tenders continue to be ingested via Devanagari OCR (`OCR_LANGS=eng+hin`).
- Criteria extraction emits `extraction_warning="untranslated_indic_text"` so
  downstream systems can surface a warning to the officer.

There is **no silent failure**: the audit log records the warning, the UI
surfaces it as a toast, and the officer sees the original Hindi clause
alongside whatever the deterministic regex engine could match against the
pre-normalised token table.

---

## 6. CI hardening for production

Once you've verified the live integration:

1. Add a CI job that hits `/v1/translate` against a staging Bhashini tenant
   on every PR — protects against schema drift on Bhashini's side.
2. Pin `TRANSLATION_BACKEND=bhashini` in the production-image entrypoint
   rather than relying on env-default fallback.
3. Pre-bake the PaddleOCR Hindi model into the ai-service Docker image so
   air-gapped deployments don't need network at first request.

The unit tests in `ai-service/tests/test_translation.py` are tenant-agnostic
(they mock `httpx.Client.post`) and stay green regardless of which Bhashini
tenant you're targeting — keep them as the contract regression suite.
