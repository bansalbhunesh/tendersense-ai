import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { logout, token } from "../../api";

type Props = {
  left?: ReactNode;
  actions?: ReactNode;
};

function decodeJwtEmail(): string | null {
  const t = token();
  if (!t) return null;
  const parts = t.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(
      atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")),
    ) as { email?: string; sub?: string };
    return payload.email || payload.sub || null;
  } catch (err) {
    /* Malformed or non-JWT tokens often throw SyntaxError from JSON.parse — expected, stay quiet. */
    if (import.meta.env.DEV && !(err instanceof SyntaxError)) {
      console.warn("[AppHeader] JWT payload decode failed:", err);
    }
    return null;
  }
}

export default function AppHeader({ left, actions }: Props) {
  const nav = useNavigate();
  const { t, i18n } = useTranslation();
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    setEmail(decodeJwtEmail());
  }, []);

  function onLogout() {
    logout();
    nav("/", { replace: true });
  }

  function setLang(lng: "en" | "hi") {
    if (i18n.language !== lng) {
      void i18n.changeLanguage(lng);
    }
  }

  const activeLang = (i18n.resolvedLanguage || i18n.language || "en").startsWith("hi") ? "hi" : "en";

  return (
    <header className="app-nav">
      <div className="topbar">
        <div className="brand">{left}</div>
        <div className="row" style={{ gap: 12 }}>
          <div className="lang-toggle" data-testid="lang-toggle" role="group" aria-label="Language">
            <button
              type="button"
              data-testid="lang-toggle-en"
              onClick={() => setLang("en")}
              aria-pressed={activeLang === "en"}
            >
              {t("common.english")}
            </button>
            <button
              type="button"
              data-testid="lang-toggle-hi"
              onClick={() => setLang("hi")}
              aria-pressed={activeLang === "hi"}
            >
              {t("common.hindi")}
            </button>
          </div>
          {email && (
            <span className="mono muted" data-testid="header-email" style={{ fontSize: "0.78rem", maxWidth: 200 }} title={email}>
              {email}
            </span>
          )}
          {actions}
          <button className="ghost" type="button" data-testid="header-logout" onClick={onLogout}>
            {t("common.logOut")}
          </button>
        </div>
      </div>
    </header>
  );
}
