#!/usr/bin/env bash
# End-to-end smoke for the Bharat-first endpoints. Hits /v1/version,
# /v1/detect-language, /v1/translate, and /v1/evaluate against a running
# ai-service. Useful for judges who want to verify the new contracts
# without running the full stack.
#
# Usage:
#   ./demo/smoke_bharat.sh                            # defaults to http://127.0.0.1:8081
#   ./demo/smoke_bharat.sh http://your-host:8081
#
# Exit codes: 0 = all green, non-zero = first failing check.
set -euo pipefail

URL=${1:-http://127.0.0.1:8081}
GREEN='\033[0;32m'
RED='\033[0;31m'
DIM='\033[2m'
RESET='\033[0m'

ok()    { printf "${GREEN}✓${RESET} %s\n" "$1"; }
fail()  { printf "${RED}✗${RESET} %s\n" "$1"; exit 1; }
trace() { printf "${DIM}  %s${RESET}\n" "$1"; }

echo "Smoking Bharat endpoints at $URL"
echo

# ---------------------------------------------------------------------------
# 1. /health and /v1/version surface the active backends
# ---------------------------------------------------------------------------
curl -fsS "$URL/health" >/dev/null || fail "/health unreachable. Is ai-service running?"
ok "/health 200"

VERSION=$(curl -fsS "$URL/v1/version")
echo "  $VERSION" | sed 's/^/  /'
echo "$VERSION" | grep -q '"llm_backend"'        || fail "/v1/version missing llm_backend"
echo "$VERSION" | grep -q '"translation_backend"' || fail "/v1/version missing translation_backend"
ok "/v1/version reports llm_backend + translation_backend"
echo

# ---------------------------------------------------------------------------
# 2. /v1/detect-language: English + Hindi inputs
# ---------------------------------------------------------------------------
EN_RESP=$(curl -fsS -X POST "$URL/v1/detect-language" \
  -H 'content-type: application/json' \
  -d '{"text":"The bidder shall have a minimum annual turnover of Rs. 5 Crore."}')
echo "$EN_RESP" | grep -q '"lang":"en"' || fail "EN detection failed: $EN_RESP"
ok "/v1/detect-language → 'en' on English clause"

HI_RESP=$(curl -fsS -X POST "$URL/v1/detect-language" \
  -H 'content-type: application/json' \
  -d '{"text":"बोलीदाता का पिछले तीन वित्तीय वर्षों में से किसी एक में न्यूनतम वार्षिक टर्नओवर रु. 5 करोड़ होना चाहिए।"}')
echo "$HI_RESP" | grep -q '"lang":"hi"' || fail "HI detection failed: $HI_RESP"
ok "/v1/detect-language → 'hi' on Devanagari clause"
echo

# ---------------------------------------------------------------------------
# 3. /v1/translate: 503 when TRANSLATION_BACKEND=disabled is the contract
# ---------------------------------------------------------------------------
TR_BACKEND=$(echo "$VERSION" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("translation_backend",""))')
TR_HTTP=$(curl -s -o /tmp/tendersense-tr.json -w '%{http_code}' -X POST "$URL/v1/translate" \
  -H 'content-type: application/json' \
  -d '{"text":"नमस्ते","src":"hi","tgt":"en"}')

if [ "$TR_BACKEND" = "disabled" ]; then
  [ "$TR_HTTP" = "503" ] || fail "Expected 503 from /v1/translate when backend=disabled, got $TR_HTTP"
  ok "/v1/translate correctly returns 503 in sovereign-disabled mode"
else
  [ "$TR_HTTP" = "200" ] || fail "Expected 200 from /v1/translate when backend=$TR_BACKEND, got $TR_HTTP"
  ok "/v1/translate 200 (backend=$TR_BACKEND)"
  trace "$(cat /tmp/tendersense-tr.json | head -c 200)"
fi
echo

# ---------------------------------------------------------------------------
# 4. /v1/evaluate against the bundled fixture (deterministic engine)
# ---------------------------------------------------------------------------
FIXTURE="$(dirname "$0")/fixtures/eval_payload.json"
[ -f "$FIXTURE" ] || fail "Missing fixture: $FIXTURE"

EVAL_RESP=$(curl -fsS -X POST "$URL/v1/evaluate" \
  -H 'content-type: application/json' \
  --data-binary "@$FIXTURE")

echo "$EVAL_RESP" | grep -q '"decisions"' || fail "/v1/evaluate response missing 'decisions' key"

# Sanity: with a sane payload, at least one decision should be ELIGIBLE or
# NOT_ELIGIBLE — not all NEEDS_REVIEW (the regression the deterministic engine fix prevents).
DETERMINISTIC_COUNT=$(echo "$EVAL_RESP" | python3 -c 'import sys,json; r=json.load(sys.stdin); print(sum(1 for d in r.get("decisions",[]) if d.get("verdict") in ("ELIGIBLE","NOT_ELIGIBLE")))')
[ "${DETERMINISTIC_COUNT:-0}" -gt 0 ] || fail "All decisions are NEEDS_REVIEW — deterministic engine regression?"
ok "/v1/evaluate produced $DETERMINISTIC_COUNT deterministic verdict(s) (ELIGIBLE / NOT_ELIGIBLE)"
echo

printf "${GREEN}All Bharat smoke checks passed.${RESET}\n"
