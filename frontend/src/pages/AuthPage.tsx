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
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 20 }}>
      <div style={{ maxWidth: 440, width: '100%' }}>
        <div className="brand" style={{ justifyContent: 'center', marginBottom: 32 }}>
          <strong style={{ fontSize: '2rem' }}>TenderSense AI</strong>
        </div>
        <div className="panel">
          <h1>Officer Access</h1>
          <p className="muted">
            Secure procurement evaluation system. Authenticate to access tender workspaces and the evaluation pipeline.
          </p>
          <form style={{ marginTop: 24 }} onSubmit={(e) => e.preventDefault()}>
            <label>Department Email</label>
            <input value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" />
            <div style={{ height: 16 }} />
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            {err && (
              <p className="mono" style={{ color: "var(--bad)", marginTop: 12, fontSize: '0.8rem' }}>
                {err}
              </p>
            )}
            <div className="row" style={{ marginTop: 24, flexWrap: 'nowrap' }}>
              <button className="primary" style={{ flex: 1 }} disabled={busy} onClick={onLogin}>
                Sign in
              </button>
              <button className="ghost" style={{ flex: 1 }} disabled={busy} onClick={onRegister}>
                Register
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
