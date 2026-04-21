const API = "/api/v1";

export function token(): string | null {
  return localStorage.getItem("ts_token");
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
      // Optional: window.location.href = "/login";
    }
    const err = await res.text();
    throw new Error(err || res.statusText);
  }
  const ct = res.headers.get("content-type");
  if (ct && ct.includes("application/json")) return res.json();
  return res.text();
}

export async function login(email: string, password: string) {
  const data = (await fetch(API + "/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }).then(async (r) => {
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  })) as { token: string };
  localStorage.setItem("ts_token", data.token);
}

export async function register(email: string, password: string) {
  const data = (await fetch(API + "/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  }).then(async (r) => {
    if (!r.ok) throw new Error(await r.text());
    return r.json();
  })) as { token: string };
  localStorage.setItem("ts_token", data.token);
}

export function logout() {
  localStorage.removeItem("ts_token");
}
