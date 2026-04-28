import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export default function NotFound() {
  useDocumentTitle("errors.notFoundDocumentTitle");
  const { t } = useTranslation();
  return (
    <div className="shell" style={{ padding: 24 }}>
      <div className="panel">
        <h1>{t("errors.notFoundTitle")}</h1>
        <p className="muted" style={{ marginTop: 8 }}>{t("errors.notFoundCopy")}</p>
        <div className="row" style={{ marginTop: 16 }}>
          <Link to="/">
            <button className="primary">{t("errors.backToSignIn")}</button>
          </Link>
          <Link to="/app">
            <button className="ghost">{t("errors.officerDashboard")}</button>
          </Link>
        </div>
      </div>
    </div>
  );
}
