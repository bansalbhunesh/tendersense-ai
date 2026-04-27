import { useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
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
  const [email, setEmail] = useState<string | null>(null);

  useEffect(() => {
    setEmail(decodeJwtEmail());
  }, []);

  function onLogout() {
    logout();
    nav("/", { replace: true });
  }

  return (
    <div className="topbar">
      <div className="brand">{left}</div>
      <div className="row" style={{ gap: 12 }}>
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
          Log out
        </button>
      </div>
    </div>
  );
}
