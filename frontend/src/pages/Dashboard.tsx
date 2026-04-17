import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch, logout } from "../api";

type TenderRow = { id: string; title: string; status: string; created_at: string };

export default function Dashboard() {
  const [title, setTitle] = useState("Construction services — eligibility screening");
  const [rows, setRows] = useState<TenderRow[]>([]);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      const data = (await apiFetch("/tenders")) as { tenders: TenderRow[] };
      setRows(data.tenders || []);
    } catch (e: unknown) {
      setErr(String(e));
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function create(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    try {
      await apiFetch("/tenders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description: "Hackathon demo tender" }),
      });
      setTitle("");
      await load();
    } catch (ex: unknown) {
      setErr(String(ex));
    }
  }

  return (
    <div className="shell">
      <div className="topbar">
        <div className="brand">
          <strong>TenderSense AI</strong>
          <span>Officer dashboard</span>
        </div>
        <div className="row">
          <Link to="/review">
            <button className="ghost">Review queue</button>
          </Link>
          <button
            className="ghost"
            onClick={() => {
              logout();
              window.location.href = "/";
            }}
          >
            Log out
          </button>
        </div>
      </div>

      <div className="grid2">
        <div className="panel">
          <h2>New tender</h2>
          <form onSubmit={create}>
            <label>Title</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} required />
            <div style={{ height: 12 }} />
            <button className="primary" type="submit">
              Create tender workspace
            </button>
          </form>
          {err && <p className="muted" style={{ color: "#ff9b9b", marginTop: 12 }}>{err}</p>}
        </div>
        <div className="panel">
          <h2>Pipeline</h2>
          <p className="muted">
            Ingest → OCR / parse → criteria extraction → decision engine with confidence propagation → reasoning
            graph → immutable audit log. Ambiguous cases never silently disqualify.
          </p>
        </div>
      </div>

      <div style={{ height: 16 }} />

      <div className="panel">
        <h2>Active tenders</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Status</th>
              <th>Open</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.title}</td>
                <td>{r.status}</td>
                <td>
                  <Link to={`/tender/${r.id}`}>Workspace →</Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={3} className="muted">
                  No tenders yet — create one to begin.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
