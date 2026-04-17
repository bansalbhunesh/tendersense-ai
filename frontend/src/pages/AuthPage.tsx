import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { login, register, token } from "../api";

export default function AuthPage() {
  const nav = useNavigate();
  const [email, setEmail] = useState("officer@demo.gov.in");
  const [password, setPassword] = useState("demo12345");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (token()) nav("/app");
  }, [nav]);

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await login(email, password);
      nav("/app");
    } catch (ex: unknown) {
      setErr(String(ex));
    } finally {
      setBusy(false);
    }
  }

  async function onRegister(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await register(email, password);
      nav("/app");
    } catch (ex: unknown) {
      setErr(String(ex));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="shell" style={{ maxWidth: 480 }}>
      <div className="topbar">
        <div className="brand">
          <strong>TenderSense AI</strong>
          <span>CRPF procurement evaluation</span>
        </div>
      </div>
      <div className="panel">
        <h1>Officer access</h1>
        <p className="muted">
          Sign in to upload tenders, run the evaluation pipeline, and review flagged criteria with full audit
          provenance.
        </p>
        <form style={{ marginTop: 16 }}>
          <label>Email</label>
          <input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
          <div style={{ height: 12 }} />
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          {err && (
            <p className="muted" style={{ color: "#ff9b9b", marginTop: 10 }}>
              {err}
            </p>
          )}
          <div className="row" style={{ marginTop: 16 }}>
            <button className="primary" disabled={busy} onClick={onLogin}>
              Sign in
            </button>
            <button className="ghost" disabled={busy} onClick={onRegister}>
              Create account
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
