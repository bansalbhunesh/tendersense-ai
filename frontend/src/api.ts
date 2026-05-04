const API = "/api/v1";

/** Access JWT — sessionStorage narrows persistence vs localStorage (tab-scoped). */
const TOKEN_KEY = "ts_token";

/** Legacy key — refresh token now lives in HttpOnly cookie when supported. */
const REFRESH_KEY = "ts_refresh";

const SESSION_HINT_KEY = "ts_session";

function markSessionHint(): void {
  try {
    sessionStorage.setItem(SESSION_HINT_KEY, "1");
  } catch {
    /* ignore */
  }
}

function clearSessionHint(): void {
  try {
    sessionStorage.removeItem(SESSION_HINT_KEY);
  } catch {
    /* ignore */
  }
}

function hasSessionHint(): boolean {
  try {
    return (
      sessionStorage.getItem(SESSION_HINT_KEY) === "1" ||
      !!sessionStorage.getItem(TOKEN_KEY) ||
      !!localStorage.getItem(REFRESH_KEY)
    );
  } catch {
    return !!localStorage.getItem(REFRESH_KEY);
  }
}

export function token(): string | null {
  try {
    const s = sessionStorage.getItem(TOKEN_KEY);
    if (s) return s;
    const leg = localStorage.getItem(TOKEN_KEY);
    if (leg) {
      sessionStorage.setItem(TOKEN_KEY, leg);
      localStorage.removeItem(TOKEN_KEY);
      return leg;
    }
    return null;
  } catch {
    return null;
  }
}

/** @deprecated Refresh is HttpOnly; kept for migration from older builds. */
export function refreshToken(): string | null {
  return localStorage.getItem(REFRESH_KEY);
}

export function setToken(value: string): void {
  try {
    sessionStorage.setItem(TOKEN_KEY, value);
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    localStorage.setItem(TOKEN_KEY, value);
  }
}

/** @deprecated */
export function setRefreshToken(value: string): void {
  localStorage.setItem(REFRESH_KEY, value);
}

export function clearToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  clearSessionHint();
}

type StructuredError = { code?: string; message?: string; request_id?: string };

const defaultFetchOpts: RequestInit = { credentials: "include" };

async function readErrorMessage(res: Response): Promise<string> {
  const text = await res.text().catch(() => "");
  const ct = res.headers.get("content-type") || "";
  if (text && ct.includes("application/json")) {
    try {
      const j = JSON.parse(text) as {
        error?: string | StructuredError;
        message?: string;
      };
      if (j?.error) {
        if (typeof j.error === "string") return j.error;
        if (typeof j.error === "object" && typeof j.error.message === "string") {
          return j.error.message;
        }
      }
      if (j?.message && typeof j.message === "string") return j.message;
    } catch {
      /* fall through */
    }
  }
  return text ? `[HTTP ${res.status}] ${text}` : `HTTP ${res.status} ${res.statusText}`;
}

async function handleUnauthorized() {
  const access = token();
  try {
    const legacyRt = refreshToken();
    const body: Record<string, string> = {};
    if (access) body.access_token = access;
    if (legacyRt) body.refresh_token = legacyRt;
    await fetch(API + "/auth/logout", {
      ...defaultFetchOpts,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    /* offline */
  }
  clearToken();
  if (typeof window !== "undefined" && window.location.pathname !== "/") {
    window.location.assign("/");
  }
}

let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const prior = token();
  const legacyRt = refreshToken();
  const body: Record<string, string> = {};
  if (prior) body.access_token = prior;
  if (legacyRt) body.refresh_token = legacyRt;
  const res = await fetch(API + "/auth/refresh", {
    ...defaultFetchOpts,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    access_token?: string;
    refresh_token?: string;
    token?: string;
  };
  const access = data.access_token || data.token || "";
  if (data.refresh_token) setRefreshToken(data.refresh_token);
  if (access) setToken(access);
  return access || null;
}

function ensureRefreshedAccess(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = refreshAccessToken().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

type AuthTokenPayload = {
  token?: string;
  access_token?: string;
  refresh_token?: string;
};

function applyAuthPayload(data: AuthTokenPayload): void {
  const access = data.access_token || data.token;
  if (access) setToken(access);
  if (data.refresh_token) setRefreshToken(data.refresh_token);
  if (access) markSessionHint();
}

export async function apiFetch(path: string, opts: RequestInit = {}) {
  const run = async (access: string | null) => {
    const headers: Record<string, string> = {
      ...(opts.headers as Record<string, string>),
    };
    if (access) headers["Authorization"] = `Bearer ${access}`;
    return fetch(API + path, { ...defaultFetchOpts, ...opts, headers });
  };

  let access = token();
  let res = await run(access);
  if (res.status === 401 && hasSessionHint()) {
    const next = await ensureRefreshedAccess();
    if (next) {
      res = await run(next);
    }
  }
  if (!res.ok) {
    if (res.status === 401) void handleUnauthorized();
    throw new Error(await readErrorMessage(res));
  }
  const ct = res.headers.get("content-type");
  if (ct && ct.includes("application/json")) return res.json();
  return res.text();
}

/**
 * Like apiFetch, but also surfaces the X-Total-Count header for pagination UIs.
 * Returns `{ data, totalCount }` where totalCount is null if the header was absent.
 */
export async function apiFetchWithMeta<T = unknown>(
  path: string,
  opts: RequestInit = {},
): Promise<{ data: T; totalCount: number | null }> {
  const run = async (access: string | null) => {
    const headers: Record<string, string> = {
      ...(opts.headers as Record<string, string>),
    };
    if (access) headers["Authorization"] = `Bearer ${access}`;
    return fetch(API + path, { ...defaultFetchOpts, ...opts, headers });
  };

  let res = await run(token());
  if (res.status === 401 && hasSessionHint()) {
    const next = await ensureRefreshedAccess();
    if (next) res = await run(next);
  }
  if (!res.ok) {
    if (res.status === 401) void handleUnauthorized();
    throw new Error(await readErrorMessage(res));
  }
  const totalHeader = res.headers.get("X-Total-Count");
  const totalCount =
    totalHeader != null && totalHeader !== "" && !Number.isNaN(Number(totalHeader))
      ? Number(totalHeader)
      : null;
  const ct = res.headers.get("content-type");
  let data: unknown;
  if (ct && ct.includes("application/json")) {
    data = await res.json();
  } else {
    data = await res.text();
  }
  return { data: data as T, totalCount };
}

export async function apiUpload(path: string, form: FormData, opts: RequestInit = {}) {
  const run = async (access: string | null) => {
    const headers: Record<string, string> = {
      ...(opts.headers as Record<string, string>),
    };
    if (access) headers["Authorization"] = `Bearer ${access}`;
    return fetch(API + path, { ...defaultFetchOpts, ...opts, method: opts.method || "POST", headers, body: form });
  };

  let res = await run(token());
  if (res.status === 401 && hasSessionHint()) {
    const next = await ensureRefreshedAccess();
    if (next) res = await run(next);
  }
  if (!res.ok) {
    if (res.status === 401) void handleUnauthorized();
    throw new Error(await readErrorMessage(res));
  }
  const ct = res.headers.get("content-type");
  if (ct && ct.includes("application/json")) return res.json();
  return res.text();
}

export async function login(email: string, password: string) {
  const r = await fetch(API + "/auth/login", {
    ...defaultFetchOpts,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(await readErrorMessage(r));
  const data = (await r.json()) as AuthTokenPayload;
  applyAuthPayload(data);
}

export async function register(email: string, password: string) {
  const r = await fetch(API + "/auth/register", {
    ...defaultFetchOpts,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(await readErrorMessage(r));
  const data = (await r.json()) as AuthTokenPayload;
  applyAuthPayload(data);
}

export async function forgotPassword(email: string): Promise<{ message: string; reset_token?: string; expires_at?: string }> {
  const r = await fetch(API + "/auth/forgot-password", {
    ...defaultFetchOpts,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!r.ok) throw new Error(await readErrorMessage(r));
  return (await r.json()) as { message: string; reset_token?: string; expires_at?: string };
}

export async function resetPassword(
  email: string,
  resetToken: string,
  newPassword: string,
): Promise<{ message: string }> {
  const r = await fetch(API + "/auth/reset-password", {
    ...defaultFetchOpts,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      reset_token: resetToken,
      new_password: newPassword,
    }),
  });
  if (!r.ok) throw new Error(await readErrorMessage(r));
  return (await r.json()) as { message: string };
}

export async function logout() {
  const access = token();
  const legacyRt = refreshToken();
  try {
    const body: Record<string, string> = {};
    if (access) body.access_token = access;
    if (legacyRt) body.refresh_token = legacyRt;
    await fetch(API + "/auth/logout", {
      ...defaultFetchOpts,
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    /* offline */
  }
  clearToken();
}
