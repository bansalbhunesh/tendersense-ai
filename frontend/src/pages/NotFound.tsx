import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export default function NotFound() {
  useDocumentTitle("errors.notFoundDocumentTitle");
  const { t } = useTranslation();
  return (
    <div className="not-found-hero">
      <div className="panel not-found-card">
        <p
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "0.72rem",
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "var(--accent)",
            margin: "0 0 12px",
          }}
        >
          404
        </p>
        <h1>{t("errors.notFoundTitle")}</h1>
        <p className="muted" style={{ marginTop: 12 }}>
          {t("errors.notFoundCopy")}
        </p>
        <div className="row" style={{ marginTop: 28, justifyContent: "center" }}>
          <Link to="/">
            <button type="button" className="primary">
              {t("errors.backToSignIn")}
            </button>
          </Link>
          <Link to="/app">
            <button type="button" className="ghost">
              {t("errors.officerDashboard")}
            </button>
          </Link>
        </div>
      </div>
    </div>
  );
}
