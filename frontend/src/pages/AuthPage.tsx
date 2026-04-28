import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { forgotPassword, login, register, resetPassword, token } from "../api";
import { useToast } from "../components/ToastProvider";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export default function AuthPage() {
  useDocumentTitle("auth.documentTitle");
  const { t } = useTranslation();
  const nav = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [resetToken, setResetToken] = useState("");
  const [mode, setMode] = useState<"login" | "register">("login");
  const [view, setView] = useState<"auth" | "forgot">("auth");
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);

  const demoEmail = import.meta.env.VITE_DEMO_EMAIL;
  const demoPassword = import.meta.env.VITE_DEMO_PASSWORD;
  const showDemoButton = Boolean(import.meta.env.DEV && demoEmail);

  useEffect(() => {
    if (token()) nav("/app");
  }, [nav]);

  useEffect(() => {
    const viewParam = searchParams.get("view");
    const modeParam = searchParams.get("mode");
    const emailParam = searchParams.get("email");
    const tokenParam = searchParams.get("token");
    if (viewParam === "forgot") {
      setView("forgot");
      if (modeParam === "reset") {
        if (emailParam) setEmail(emailParam);
        if (tokenParam) setResetToken(tokenParam);
      }
      // Clean URL so tokens are not left in browser history/share.
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  function validate(targetMode: "login" | "register"): string | null {
    if (!email.trim()) return "Email is required.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return "Enter a valid email address.";
    if (!password) return "Password is required.";
    if (password.length < 8) return "Password must be at least 8 characters.";
    if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
      return "Password must include at least one letter and one number.";
    }
    if (targetMode === "register" && password !== confirmPassword) {
      return "Confirm password does not match.";
    }
    return null;
  }

  const hasMinLen = password.length >= 8;
  const hasLetter = /[A-Za-z]/.test(password);
  const hasNumber = /\d/.test(password);
  const confirmMatches = mode !== "register" || password === confirmPassword;

  async function onLogin(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const validationError = validate("login");
    if (validationError) { setErr(validationError); return; }
    setBusy(true);
    setErr(null);
    setInfo(null);
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
    if (busy) return;
    const validationError = validate("register");
    if (validationError) { setErr(validationError); return; }
    setBusy(true);
    setErr(null);
    setInfo(null);
    try {
      await register(email.trim(), password);
      setInfo("Account created. Redirecting...");
      nav("/app");
    } catch (ex: unknown) {
      const message = ex instanceof Error ? ex.message : String(ex);
      setErr(message);
      toast.error(t("auth.registrationFailed", { message }));
    } finally {
      setBusy(false);
    }
  }

  async function onForgotPassword(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!email.trim()) {
      setErr("Email is required.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      setErr("Enter a valid email address.");
      return;
    }
    setBusy(true);
    setErr(null);
    setInfo(null);
    try {
      if (resetToken.trim()) {
        if (password.length < 8 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
          setErr("New password must be 8+ chars with letter + number.");
          return;
        }
        if (password !== confirmPassword) {
          setErr("Confirm password does not match.");
          return;
        }
        const res = await resetPassword(email.trim(), resetToken.trim(), password);
        setInfo(res.message);
        setView("auth");
        setMode("login");
        setResetToken("");
        setPassword("");
        setConfirmPassword("");
        return;
      }
      const res = await forgotPassword(email.trim());
      setInfo(
        res.reset_token
          ? `Reset token generated. Copy token: ${res.reset_token}`
          : res.message,
      );
      if (res.reset_token) {
        setResetToken(res.reset_token);
      }
    } catch (ex: unknown) {
      const message = ex instanceof Error ? ex.message : String(ex);
      setErr(message);
      toast.error(`Password reset failed: ${message}`);
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
          <h1>{view === "forgot" ? "Reset password" : t("auth.title")}</h1>
          <p className="muted">
            {view === "forgot"
              ? "Request a reset token, then set a new password."
              : t("auth.subtitle")}
          </p>
          <form
            style={{ marginTop: 24 }}
            onSubmit={(e) => {
              if (view === "forgot") {
                void onForgotPassword(e);
                return;
              }
              if (mode === "register") {
                void onRegister(e);
                return;
              }
              void onLogin(e);
            }}
          >
            <label>{t("auth.departmentEmail")}</label>
            <input
              data-testid="auth-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
            />
            <div style={{ height: 16 }} />
            {(view === "auth" || !!resetToken) && (
              <>
                <label>{view === "forgot" && resetToken ? "New Password" : t("auth.password")}</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    data-testid="auth-password"
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setShowPassword((v) => !v)}
                    style={{ minWidth: 86 }}
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
                <p style={{ fontSize: "0.72rem", color: "var(--muted)", marginTop: 4 }}>
                  Minimum 8 characters, with letter + number
                </p>
              </>
            )}
            {mode === "register" && (
              <div style={{ fontSize: "0.74rem", color: "var(--muted)", marginTop: 6, lineHeight: 1.6 }}>
                <div style={{ color: hasMinLen ? "var(--good)" : "var(--muted)" }}>
                  {hasMinLen ? "✓" : "•"} At least 8 characters
                </div>
                <div style={{ color: hasLetter ? "var(--good)" : "var(--muted)" }}>
                  {hasLetter ? "✓" : "•"} Contains a letter
                </div>
                <div style={{ color: hasNumber ? "var(--good)" : "var(--muted)" }}>
                  {hasNumber ? "✓" : "•"} Contains a number
                </div>
                <div style={{ color: confirmMatches ? "var(--good)" : "var(--bad)" }}>
                  {confirmMatches ? "✓" : "•"} Confirm password matches
                </div>
              </div>
            )}
            {(mode === "register" || (view === "forgot" && !!resetToken)) && (
              <>
                <div style={{ height: 14 }} />
                <label>{view === "forgot" ? "Confirm New Password" : "Confirm Password"}</label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    data-testid="auth-confirm-password"
                    type={showConfirmPassword ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => setShowConfirmPassword((v) => !v)}
                    style={{ minWidth: 86 }}
                  >
                    {showConfirmPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </>
            )}
            {view === "forgot" && (
              <>
                <div style={{ height: 14 }} />
                <label>Reset Token</label>
                <input
                  data-testid="auth-reset-token"
                  value={resetToken}
                  onChange={(e) => setResetToken(e.target.value)}
                  placeholder="Paste reset token"
                  autoComplete="off"
                />
              </>
            )}
            {err && (
              <p
                className="mono"
                data-testid="auth-error"
                style={{ color: "var(--bad)", marginTop: 12, fontSize: '0.8rem' }}
              >
                {err}
              </p>
            )}
            {info && (
              <p
                className="mono"
                style={{ color: "var(--good)", marginTop: 12, fontSize: "0.8rem" }}
              >
                {info}
              </p>
            )}
            {view === "auth" && (
              <div className="row" style={{ marginTop: 12, gap: 8 }}>
              <button
                type="button"
                className={mode === "login" ? "primary" : "ghost"}
                style={{ flex: 1 }}
                disabled={busy}
                onClick={() => {
                  setMode("login");
                  setErr(null);
                  setInfo(null);
                }}
              >
                Sign-in mode
              </button>
              <button
                type="button"
                className={mode === "register" ? "primary" : "ghost"}
                style={{ flex: 1 }}
                disabled={busy}
                onClick={() => {
                  setMode("register");
                  setErr(null);
                  setInfo(null);
                }}
              >
                Register mode
              </button>
              </div>
            )}
            <div className="row" style={{ marginTop: 24, flexWrap: 'nowrap' }}>
              <button
                data-testid="auth-login"
                type="submit"
                className="primary"
                style={{ flex: 1 }}
                disabled={busy}
              >
                {busy
                  ? view === "forgot"
                    ? resetToken
                      ? "Resetting..."
                      : "Generating token..."
                    : mode === "register"
                    ? "Registering..."
                    : "Signing in..."
                  : view === "forgot"
                    ? resetToken
                      ? "Reset Password"
                      : "Generate Reset Token"
                  : mode === "register"
                    ? "Create account"
                    : t("auth.signIn")}
              </button>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button
                type="button"
                className="ghost"
                style={{ width: "100%" }}
                onClick={() => {
                  setErr(null);
                  setInfo(null);
                  setPassword("");
                  setConfirmPassword("");
                  setResetToken("");
                  setView((v) => (v === "auth" ? "forgot" : "auth"));
                }}
              >
                {view === "auth" ? "Forgot password?" : "Back to sign in"}
              </button>
            </div>
            {mode === "register" && (
              <p style={{ fontSize: "0.72rem", color: "var(--muted)", marginTop: 10 }}>
                Create your officer account to start tender evaluation and audit-ready review.
              </p>
            )}
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
