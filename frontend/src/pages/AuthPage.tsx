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

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await login(email, password);
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
    setBusy(true);
    setErr(null);
    try {
      await register(email, password);
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
      <div style={{ maxWidth: 440, width: '100%' }}>
        <div className="brand" style={{ justifyContent: 'center', marginBottom: 32 }}>
          <strong style={{ fontSize: '2rem' }}>{t("common.appName")}</strong>
        </div>
        <div className="panel">
          <h1>{t("auth.title")}</h1>
          <p className="muted">{t("auth.subtitle")}</p>
          <form style={{ marginTop: 24 }} onSubmit={(e) => e.preventDefault()}>
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
              <button data-testid="auth-login" className="primary" style={{ flex: 1 }} disabled={busy} onClick={onLogin}>
                {t("auth.signIn")}
              </button>
              <button data-testid="auth-register" className="ghost" style={{ flex: 1 }} disabled={busy} onClick={onRegister}>
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
