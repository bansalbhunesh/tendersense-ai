const API = "/api/v1";

export function token(): string | null {
  return localStorage.getItem("ts_token");
}

export function setToken(value: string): void {
  localStorage.setItem("ts_token", value);
}

export function clearToken(): void {
  localStorage.removeItem("ts_token");
}

type StructuredError = { code?: string; message?: string; request_id?: string };

async function readErrorMessage(res: Response): Promise<string> {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try {
      const j = (await res.json()) as {
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
  const t = await res.text();
  return t || res.statusText;
}

function handleUnauthorized() {
  clearToken();
  if (typeof window !== "undefined" && window.location.pathname !== "/") {
    window.location.assign("/");
  }
}

export async function apiFetch(path: string, opts: RequestInit = {}) {
  const t = token();
  const headers: Record<string, string> = {
    ...(opts.headers as Record<string, string>),
  };
  if (t) headers["Authorization"] = `Bearer ${t}`;
  const res = await fetch(API + path, { ...opts, headers });
  if (!res.ok) {
    if (res.status === 401) handleUnauthorized();
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
  const t = token();
  const headers: Record<string, string> = {
    ...(opts.headers as Record<string, string>),
  };
  if (t) headers["Authorization"] = `Bearer ${t}`;
  const res = await fetch(API + path, { ...opts, headers });
  if (!res.ok) {
    if (res.status === 401) handleUnauthorized();
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
  const t = token();
  const headers: Record<string, string> = {
    ...(opts.headers as Record<string, string>),
  };
  if (t) headers["Authorization"] = `Bearer ${t}`;
  const res = await fetch(API + path, { ...opts, method: opts.method || "POST", headers, body: form });
  if (!res.ok) {
    if (res.status === 401) handleUnauthorized();
    throw new Error(await readErrorMessage(res));
  }
  const ct = res.headers.get("content-type");
  if (ct && ct.includes("application/json")) return res.json();
  return res.text();
}

export async function login(email: string, password: string) {
  const r = await fetch(API + "/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(await readErrorMessage(r));
  const data = (await r.json()) as { token: string };
  setToken(data.token);
}

export async function register(email: string, password: string) {
  const r = await fetch(API + "/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(await readErrorMessage(r));
  const data = (await r.json()) as { token: string };
  setToken(data.token);
}

export function logout() {
  clearToken();
}
