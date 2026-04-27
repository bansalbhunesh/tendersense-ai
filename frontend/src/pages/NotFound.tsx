import { Link } from "react-router-dom";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

export default function NotFound() {
  useDocumentTitle("Not found · TenderSense AI");
  return (
    <div className="shell" style={{ padding: 24 }}>
      <div className="panel">
        <h1>404 — page not found</h1>
        <p className="muted" style={{ marginTop: 8 }}>
          The route you tried to open does not exist in this build. Use the link
          below to go back to a known landing page.
        </p>
        <div className="row" style={{ marginTop: 16 }}>
          <Link to="/">
            <button className="primary">Back to sign in</button>
          </Link>
          <Link to="/app">
            <button className="ghost">Officer dashboard</button>
          </Link>
        </div>
      </div>
    </div>
  );
}
