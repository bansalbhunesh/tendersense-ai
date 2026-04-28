#!/usr/bin/env python3
"""Throughput benchmark for the TenderSense AI service `/v1/evaluate` endpoint.

Spawns N concurrent eval requests against a running ai-service and reports
wall-clock throughput plus latency percentiles. Reuses a fixture payload
bundled under `demo/fixtures/eval_payload.json` (4 criteria, 2 bidders) so
the run is deterministic.

Usage
-----
    python demo/benchmark.py                           # 20 concurrent reqs
    python demo/benchmark.py --n 50 --concurrency 10
    python demo/benchmark.py --url http://localhost:8081 --payload demo/fixtures/eval_payload.json

The script reads ANTHROPIC_API_KEY from the environment automatically when
present (the ai-service handles the actual key — we just don't strip it).
For deterministic runs without a key, ensure the service is started with
`LLM_BACKEND=disabled` so the regex/heuristic path is taken.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import statistics
import sys
import time
from pathlib import Path
from typing import Any


DEFAULT_URL = "http://localhost:8081"
DEFAULT_PAYLOAD = Path(__file__).resolve().parent / "fixtures" / "eval_payload.json"


def _percentile(values: list[float], pct: float) -> float:
    """Nearest-rank percentile in ms. `pct` is 0..100."""
    if not values:
        return 0.0
    s = sorted(values)
    k = max(0, min(len(s) - 1, int(round((pct / 100.0) * (len(s) - 1)))))
    return s[k]


def _fmt_ms(v: float) -> str:
    return f"{v * 1000:8.1f} ms"


def load_payload(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict) or "tender_id" not in data:
        raise SystemExit(f"Invalid payload at {path}: expected dict with tender_id")
    return data


async def _one_request(
    client: Any, url: str, payload: dict[str, Any], idx: int
) -> tuple[int, float, str]:
    """POST one /v1/evaluate; returns (status, elapsed_seconds, error_or_blank)."""
    # We tag the tender_id per-request so the ai-service cache doesn't trivially
    # collapse all requests into a single response (which would make the
    # benchmark measure a cache hit, not real throughput).
    body = dict(payload)
    body["tender_id"] = f"{payload.get('tender_id', 'bench')}-{idx:05d}"

    t0 = time.perf_counter()
    try:
        r = await client.post(f"{url.rstrip('/')}/v1/evaluate", json=body)
        elapsed = time.perf_counter() - t0
        if r.status_code >= 400:
            return r.status_code, elapsed, r.text[:200]
        return r.status_code, elapsed, ""
    except Exception as e:  # network / timeout
        return 0, time.perf_counter() - t0, f"{type(e).__name__}: {e}"


async def run_benchmark(
    url: str,
    payload: dict[str, Any],
    n: int,
    concurrency: int,
    timeout_s: float,
) -> dict[str, Any]:
    try:
        import httpx
    except ImportError as e:  # pragma: no cover
        raise SystemExit(
            "httpx is required. Install with: pip install -r demo/requirements.txt"
        ) from e

    sem = asyncio.Semaphore(concurrency)
    results: list[tuple[int, float, str]] = []

    async with httpx.AsyncClient(timeout=timeout_s) as client:
        async def _bounded(i: int) -> tuple[int, float, str]:
            async with sem:
                return await _one_request(client, url, payload, i)

        wall_t0 = time.perf_counter()
        tasks = [asyncio.create_task(_bounded(i)) for i in range(n)]
        results = await asyncio.gather(*tasks)
        wall = time.perf_counter() - wall_t0

    latencies = [e for (s, e, _err) in results if s == 200]
    errors = [(s, err) for (s, _e, err) in results if s != 200]

    summary: dict[str, Any] = {
        "url": url,
        "n_requests": n,
        "concurrency": concurrency,
        "wall_seconds": wall,
        "ok": len(latencies),
        "errors": len(errors),
        "throughput_rps": (len(latencies) / wall) if wall > 0 else 0.0,
        "latency_seconds": {
            "avg": statistics.fmean(latencies) if latencies else 0.0,
            "median": statistics.median(latencies) if latencies else 0.0,
            "p95": _percentile(latencies, 95),
            "p99": _percentile(latencies, 99),
            "min": min(latencies) if latencies else 0.0,
            "max": max(latencies) if latencies else 0.0,
        },
        "first_errors": errors[:5],
    }
    return summary


def print_summary(s: dict[str, Any]) -> None:
    lat = s["latency_seconds"]
    print()
    print(f"=== /v1/evaluate benchmark ({s['url']}) ===")
    print(f"  requests       : {s['n_requests']}  (concurrency={s['concurrency']})")
    print(f"  ok / errors    : {s['ok']} / {s['errors']}")
    print(f"  wall time      : {s['wall_seconds']:.2f} s")
    print(f"  throughput     : {s['throughput_rps']:.2f} req/s")
    print(f"  latency avg    : {_fmt_ms(lat['avg'])}")
    print(f"  latency median : {_fmt_ms(lat['median'])}")
    print(f"  latency p95    : {_fmt_ms(lat['p95'])}")
    print(f"  latency p99    : {_fmt_ms(lat['p99'])}")
    print(f"  latency min/max: {_fmt_ms(lat['min'])} / {_fmt_ms(lat['max'])}")
    if s["first_errors"]:
        print()
        print("  first errors (status, body):")
        for status, body in s["first_errors"]:
            print(f"    [{status}] {body[:160]}")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Benchmark TenderSense AI /v1/evaluate")
    p.add_argument("--url", default=DEFAULT_URL, help=f"AI service base URL (default {DEFAULT_URL})")
    p.add_argument("--n", type=int, default=20, help="Total number of requests (default 20)")
    p.add_argument(
        "--concurrency",
        type=int,
        default=10,
        help="Max in-flight requests (default 10)",
    )
    p.add_argument(
        "--payload",
        default=str(DEFAULT_PAYLOAD),
        help="Path to JSON payload (default demo/fixtures/eval_payload.json)",
    )
    p.add_argument(
        "--timeout",
        type=float,
        default=120.0,
        help="Per-request timeout in seconds (default 120)",
    )
    p.add_argument(
        "--json",
        action="store_true",
        help="Print summary as JSON instead of human-readable text",
    )
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    payload_path = Path(args.payload).expanduser().resolve()
    if not payload_path.is_file():
        print(f"ERROR: payload not found: {payload_path}", file=sys.stderr)
        return 2
    payload = load_payload(payload_path)

    # ANTHROPIC_API_KEY is consumed by the ai-service itself; we just note it.
    has_key = bool(os.getenv("ANTHROPIC_API_KEY"))
    if not args.json:
        print(f"payload : {payload_path}")
        print(f"target  : {args.url}/v1/evaluate")
        print(f"key set : {has_key}  (ai-service decides backend)")

    try:
        summary = asyncio.run(
            run_benchmark(
                url=args.url,
                payload=payload,
                n=args.n,
                concurrency=args.concurrency,
                timeout_s=args.timeout,
            )
        )
    except KeyboardInterrupt:
        print("\nInterrupted.", file=sys.stderr)
        return 130

    if args.json:
        # Drop non-JSON-serialisable tuples in first_errors.
        summary["first_errors"] = [
            {"status": s, "body": b} for (s, b) in summary["first_errors"]
        ]
        json.dump(summary, sys.stdout, indent=2)
        sys.stdout.write("\n")
    else:
        print_summary(summary)
    return 0 if summary["errors"] == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
