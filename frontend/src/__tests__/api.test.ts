import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiFetch, apiFetchWithMeta, clearToken, refreshToken, setRefreshToken, setToken, token } from "../api";

const originalFetch = globalThis.fetch;
const originalAssign = window.location.assign;

function jsonResponse(body: unknown, init?: ResponseInit, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
    ...init,
  });
}

describe("api token helpers", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("stores, reads, and clears the token", () => {
    expect(token()).toBeNull();
    setToken("abc.def.ghi");
    expect(token()).toBe("abc.def.ghi");
    clearToken();
    expect(token()).toBeNull();
  });

  it("clears refresh token with clearToken", () => {
    setRefreshToken("refresh-secret");
    expect(refreshToken()).toBe("refresh-secret");
    clearToken();
    expect(refreshToken()).toBeNull();
  });
});

describe("apiFetch unauthorized handling", () => {
  let assignSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    localStorage.clear();
    setToken("abc.def.ghi");
    assignSpy = vi.fn();
    Object.defineProperty(window, "location", {
      value: { ...window.location, pathname: "/app", assign: assignSpy },
      writable: true,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    Object.defineProperty(window, "location", {
      value: { ...window.location, assign: originalAssign },
      writable: true,
    });
  });

  it("clears the stored token and redirects on a 401 response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("nope", { status: 401, headers: { "content-type": "text/plain" } }),
    );
    await expect(apiFetch("/protected")).rejects.toThrow();
    expect(token()).toBeNull();
    expect(assignSpy).toHaveBeenCalledWith("/");
  });

  it("does not redirect when already on the auth landing page", async () => {
    Object.defineProperty(window, "location", {
      value: { ...window.location, pathname: "/", assign: assignSpy },
      writable: true,
    });
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response("nope", { status: 401, headers: { "content-type": "text/plain" } }),
    );
    await expect(apiFetch("/protected")).rejects.toThrow();
    expect(token()).toBeNull();
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it("attaches the bearer header when a token is present", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    globalThis.fetch = fetchMock;
    await apiFetch("/me");
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers.Authorization).toBe("Bearer abc.def.ghi");
  });

  it("retries with refreshed access token after 401 when refresh_token is stored", async () => {
    setRefreshToken("rt1");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("expired", { status: 401 }))
      .mockResolvedValueOnce(
        jsonResponse({ access_token: "new.access", refresh_token: "rt2", token: "new.access" }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    globalThis.fetch = fetchMock;
    await apiFetch("/me");
    expect(token()).toBe("new.access");
    expect(refreshToken()).toBe("rt2");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const urls = fetchMock.mock.calls.map((c) => String(c[0] ?? ""));
    expect(urls[0]).toContain("/me");
    expect(urls[1]).toContain("/auth/refresh");
    expect(urls[2]).toContain("/me");
  });
});

describe("apiFetch error message parsing", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("extracts message from the structured backend error envelope", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: { code: "bad_request", message: "limit must be <= 200", request_id: "abc" },
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );
    await expect(apiFetch("/tenders?limit=999")).rejects.toThrow("limit must be <= 200");
  });

  it("still extracts message from the legacy {error: string} shape", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "legacy plain error" }), {
        status: 400,
        headers: { "content-type": "application/json" },
      }),
    );
    await expect(apiFetch("/legacy")).rejects.toThrow("legacy plain error");
  });
});

describe("apiFetchWithMeta", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns numeric totalCount when X-Total-Count header is present", async () => {
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse({ tenders: [] }, undefined, { "X-Total-Count": "42" }));
    const res = await apiFetchWithMeta<{ tenders: unknown[] }>("/tenders?limit=50&offset=0");
    expect(res.totalCount).toBe(42);
    expect(res.data.tenders).toEqual([]);
  });

  it("returns null totalCount when X-Total-Count header is absent", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(jsonResponse({ tenders: [] }));
    const res = await apiFetchWithMeta<{ tenders: unknown[] }>("/tenders");
    expect(res.totalCount).toBeNull();
  });
});
