"""Optional Redis cache; no-ops when REDIS_URL unset or redis unavailable."""

from __future__ import annotations

import hashlib
import json
import logging
import os
from typing import Any

logger = logging.getLogger("tendersense-ai.cache")

try:
    import redis  # type: ignore
except ImportError:
    redis = None  # type: ignore

_client: Any | None | bool = None  # None=unset, False=disabled, else client


def _get_client() -> Any | None:
    global _client
    if _client is False:
        return None
    if _client is not None:
        return _client  # type: ignore[return-value]

    url = os.getenv("REDIS_URL", "").strip()
    if not url or redis is None:
        _client = False
        return None
    try:
        c = redis.from_url(url, decode_responses=True, socket_connect_timeout=2.0)
        _client = c
        logger.info("Redis cache connected")
        return c
    except Exception as e:
        logger.warning("Redis unavailable, caching disabled: %s", e)
        _client = False
        return None


def stable_hash_key(prefix: str, *parts: str) -> str:
    h = hashlib.sha256()
    for p in parts:
        h.update((p or "").encode())
    return f"{prefix}:{h.hexdigest()[:48]}"


def cache_get(key: str) -> str | None:
    r = _get_client()
    if not r:
        return None
    try:
        return r.get(key)
    except Exception as e:
        logger.debug("cache get %s: %s", key, e)
        return None


def cache_set(key: str, value: str, ttl_seconds: int) -> None:
    r = _get_client()
    if not r:
        return
    try:
        r.setex(key, ttl_seconds, value)
    except Exception as e:
        logger.debug("cache set %s: %s", key, e)


def cache_get_json(key: str) -> Any | None:
    raw = cache_get(key)
    if not raw:
        return None
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        return None


def cache_set_json(key: str, value: Any, ttl_seconds: int) -> None:
    try:
        cache_set(key, json.dumps(value, default=str), ttl_seconds)
    except (TypeError, ValueError):
        pass
