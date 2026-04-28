import { FormEvent, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { login, register, token } from "../api";
import { useToast } from "../components/ToastProvider";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export default function AuthPage() {
  useDocumentTitle("auth.documentTitle");
  const { t } = useTranslation();
  const nav = useNavigate();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const demoEmail = import.meta.env.VITE_DEMO_EMAIL;
  const demoPassword = import.meta.env.VITE_DEMO_PASSWORD;
  const showDemoButton = Boolean(import.meta.env.DEV && demoEmail);

  useEffect(() => {
    if (token()) nav("/app");
  }, [nav]);

  function validate(): string | null {
    if (!email.trim()) return "Email is required.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return "Enter a valid email address.";
    if (!password) return "Password is required.";
    if (password.length < 8) return "Password must be at least 8 characters.";
    return null;
  }

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    const validationError = validate();
    if (validationError) { setErr(validationError); return; }
    setBusy(true);
    setErr(null);
    try {
      await login(email.trim(), password);
      nav("/app");
    } catch (ex: unknown) {
      const message = ex instanceof Error ? ex.message : String(ex);
      setErr(message);
      toast.error(t("auth.signInFailed", { message }));
    } finally {
      setBusy(false);
    }
  }

  async function onRegister(e: FormEvent) {
    e.preventDefault();
    const validationError = validate();
    if (validationError) { setErr(validationError); return; }
    setBusy(true);
    setErr(null);
    try {
      await register(email.trim(), password);
      nav("/app");
    } catch (ex: unknown) {
      const message = ex instanceof Error ? ex.message : String(ex);
      setErr(message);
      toast.error(t("auth.registrationFailed", { message }));
    } finally {
      setBusy(false);
    }
  }

  function fillDemo() {
    if (demoEmail) setEmail(demoEmail);
    if (demoPassword) setPassword(demoPassword);
  }

  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh', padding: 20 }}>
      <div style={{ maxWidth: 480, width: '100%' }}>
        {/* Hero statement */}
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '4px 14px',
              borderRadius: 20,
              background: 'rgba(245,158,11,0.1)',
              border: '1px solid rgba(245,158,11,0.3)',
              fontSize: '0.72rem',
              fontWeight: 700,
              color: '#f59e0b',
              letterSpacing: '0.06em',
              marginBottom: 16,
            }}
          >
            🇮🇳 AI for Bharat · Explainable Public Procurement
          </div>
          <h1
            style={{
              margin: '0 0 12px',
              fontSize: '2.2rem',
              fontWeight: 900,
              letterSpacing: '-0.03em',
              background: 'linear-gradient(135deg, #fff 30%, #9ca3af)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              lineHeight: 1.15,
            }}
          >
            {t("common.appName")}
          </h1>
          <p
            style={{
              margin: 0,
              color: 'var(--muted)',
              fontSize: '0.9rem',
              lineHeight: 1.6,
              maxWidth: 380,
              marginInline: 'auto',
            }}
          >
            Thousands of MSMEs lose tenders they deserve — because the
            evaluation process is manual, inconsistent, and impossible to audit.
            <br />
            <span style={{ color: 'var(--text)', fontWeight: 600 }}>
              TenderSense AI makes every verdict explainable.
            </span>
          </p>
        </div>

        <div className="panel">
          <h1>{t("auth.title")}</h1>
          <p className="muted">{t("auth.subtitle")}</p>
          <form style={{ marginTop: 24 }} onSubmit={onLogin}>
            <label>{t("auth.departmentEmail")}</label>
            <input
              data-testid="auth-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
            />
            <div style={{ height: 16 }} />
            <label>{t("auth.password")}</label>
            <input
              data-testid="auth-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
            <p style={{ fontSize: "0.72rem", color: "var(--muted)", marginTop: 4 }}>
              Minimum 8 characters
            </p>
            {err && (
              <p
                className="mono"
                data-testid="auth-error"
                style={{ color: "var(--bad)", marginTop: 12, fontSize: '0.8rem' }}
              >
                {err}
              </p>
            )}
            <div className="row" style={{ marginTop: 24, flexWrap: 'nowrap' }}>
              <button data-testid="auth-login" type="submit" className="primary" style={{ flex: 1 }} disabled={busy}>
                {t("auth.signIn")}
              </button>
              <button data-testid="auth-register" type="button" className="ghost" style={{ flex: 1 }} disabled={busy} onClick={onRegister}>
                {t("auth.register")}
              </button>
            </div>
            {showDemoButton && (
              <button
                type="button"
                className="ghost"
                data-testid="auth-fill-demo"
                style={{ marginTop: 12, width: "100%", fontSize: "0.8rem" }}
                onClick={fillDemo}
              >
                {t("auth.fillDemo")}
              </button>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
