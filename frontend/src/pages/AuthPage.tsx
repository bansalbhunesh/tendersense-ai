import { FormEvent, useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { forgotPassword, login, register, resetPassword, token } from "../api";
import { useToast } from "../components/shell/ToastProvider";
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
    if (validationError) {
      setErr(validationError);
      return;
    }
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
    if (validationError) {
      setErr(validationError);
      return;
    }
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
          setBusy(false);
          return;
        }
        if (password !== confirmPassword) {
          setErr("Confirm password does not match.");
          setBusy(false);
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
      if (res.reset_token && import.meta.env.DEV) {
        setInfo(`Reset token generated. Copy token: ${res.reset_token}`);
      } else if (res.reset_token) {
        setInfo(res.message ?? "If an account exists for this email, reset instructions have been sent.");
      } else {
        setInfo(res.message);
      }
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
    <div className="auth-layout">
      <aside className="auth-hero">
        <div className="auth-hero__inner">
          <p className="eyebrow">Sovereign procurement intelligence</p>
          <h1>{t("common.appName")}</h1>
          <p className="auth-lead">{t("auth.heroLead")}</p>
          <ul className="auth-trust">
            <li>{t("auth.trust1")}</li>
            <li>{t("auth.trust2")}</li>
            <li>{t("auth.trust3")}</li>
          </ul>
        </div>
      </aside>

      <main className="auth-main">
        <div className="auth-card panel">
          <h2 className="auth-form-title">
            {view === "forgot" ? "Reset password" : t("auth.title")}
          </h2>
          <p className="muted" style={{ marginTop: 6 }}>
            {view === "forgot" ? "Request a reset token, then set a new password." : t("auth.subtitle")}
          </p>
          <form
            style={{ marginTop: 22 }}
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
            <label htmlFor="auth-field-email">{t("auth.departmentEmail")}</label>
            <input
              id="auth-field-email"
              data-testid="auth-email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
            />
            <div style={{ height: 16 }} />
            {(view === "auth" || !!resetToken) && (
              <>
                <label htmlFor="auth-field-password">
                  {view === "forgot" && resetToken ? "New Password" : t("auth.password")}
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    id="auth-field-password"
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
                    aria-expanded={showPassword}
                    aria-controls="auth-field-password"
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
                <div style={{ color: hasMinLen ? "var(--ok-fg)" : "var(--muted)" }}>
                  {hasMinLen ? "✓" : "•"} At least 8 characters
                </div>
                <div style={{ color: hasLetter ? "var(--ok-fg)" : "var(--muted)" }}>
                  {hasLetter ? "✓" : "•"} Contains a letter
                </div>
                <div style={{ color: hasNumber ? "var(--ok-fg)" : "var(--muted)" }}>
                  {hasNumber ? "✓" : "•"} Contains a number
                </div>
                <div style={{ color: confirmMatches ? "var(--ok-fg)" : "var(--bad-fg)" }}>
                  {confirmMatches ? "✓" : "•"} Confirm password matches
                </div>
              </div>
            )}
            {(mode === "register" || (view === "forgot" && !!resetToken)) && (
              <>
                <div style={{ height: 14 }} />
                <label htmlFor="auth-field-confirm">
                  {view === "forgot" ? "Confirm New Password" : "Confirm Password"}
                </label>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    id="auth-field-confirm"
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
                    aria-expanded={showConfirmPassword}
                    aria-controls="auth-field-confirm"
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
                <label htmlFor="auth-field-reset-token">Reset Token</label>
                <input
                  id="auth-field-reset-token"
                  data-testid="auth-reset-token"
                  value={resetToken}
                  onChange={(e) => setResetToken(e.target.value)}
                  placeholder="Paste reset token"
                  autoComplete="off"
                />
              </>
            )}
            {err && (
              <p className="mono auth-error" data-testid="auth-error">
                {err}
              </p>
            )}
            {info && (
              <p className="mono" style={{ color: "var(--ok-fg)", marginTop: 12, fontSize: "0.8rem" }}>
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
            <div className="row" style={{ marginTop: 24, flexWrap: "nowrap" }}>
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
                style={{ marginTop: 14, width: "100%", fontSize: "0.82rem" }}
                onClick={fillDemo}
              >
                {t("auth.fillDemo")}
              </button>
            )}
          </form>
        </div>
      </main>
    </div>
  );
}
