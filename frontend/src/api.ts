const API = "/api/v1";

export function token(): string | null {
  return localStorage.getItem("ts_token");
}

async function readErrorMessage(res: Response): Promise<string> {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try {
      const j = (await res.json()) as { error?: string; message?: string };
      if (j?.error && typeof j.error === "string") return j.error;
      if (j?.message && typeof j.message === "string") return j.message;
    } catch {
      /* fall through */
    }
  }
  const t = await res.text();
  return t || res.statusText;
}

export async function apiFetch(path: string, opts: RequestInit = {}) {
  const t = token();
  const headers: Record<string, string> = {
    ...(opts.headers as Record<string, string>),
  };
  if (t) headers["Authorization"] = `Bearer ${t}`;
  const res = await fetch(API + path, { ...opts, headers });
  if (!res.ok) {
    if (res.status === 401) {
      localStorage.removeItem("ts_token");
      if (typeof window !== "undefined" && window.location.pathname !== "/") {
        window.location.assign("/");
      }
    }
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
  localStorage.setItem("ts_token", data.token);
}

export async function register(email: string, password: string) {
  const r = await fetch(API + "/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!r.ok) throw new Error(await readErrorMessage(r));
  const data = (await r.json()) as { token: string };
  localStorage.setItem("ts_token", data.token);
}

export function logout() {
  localStorage.removeItem("ts_token");
}
