import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { logout, token } from "../api";

type Props = {
  /** Slot for left brand/back-link content above the header divider */
  left?: ReactNode;
  /** Optional extra actions to render between officer email and logout */
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
  } catch {
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
  const activeStyle = {
    background: "var(--saffron-glow, rgba(245, 158, 11, 0.18))",
    border: "1px solid rgba(245, 158, 11, 0.55)",
  } as const;
  const inactiveStyle = {
    background: "transparent",
    border: "1px solid var(--border, rgba(148,163,184,0.35))",
  } as const;

  return (
    <div className="topbar">
      <div className="brand">{left}</div>
      <div className="row" style={{ gap: 12 }}>
        <div
          className="row"
          data-testid="lang-toggle"
          role="group"
          aria-label="Language"
          style={{ gap: 4 }}
        >
          <button
            type="button"
            data-testid="lang-toggle-en"
            onClick={() => setLang("en")}
            aria-pressed={activeLang === "en"}
            style={{
              padding: "4px 10px",
              fontSize: "0.75rem",
              borderRadius: 6,
              cursor: "pointer",
              ...(activeLang === "en" ? activeStyle : inactiveStyle),
            }}
          >
            {t("common.english")}
          </button>
          <button
            type="button"
            data-testid="lang-toggle-hi"
            onClick={() => setLang("hi")}
            aria-pressed={activeLang === "hi"}
            style={{
              padding: "4px 10px",
              fontSize: "0.75rem",
              borderRadius: 6,
              cursor: "pointer",
              ...(activeLang === "hi" ? activeStyle : inactiveStyle),
            }}
          >
            {t("common.hindi")}
          </button>
        </div>
        {email && (
          <span
            className="mono muted"
            data-testid="header-email"
            style={{ fontSize: "0.8rem" }}
          >
            {email}
          </span>
        )}
        {actions}
        <button
          className="ghost"
          type="button"
          data-testid="header-logout"
          onClick={onLogout}
        >
          {t("common.logOut")}
        </button>
      </div>
    </div>
  );
}
