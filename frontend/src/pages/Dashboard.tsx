import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch, logout } from "../api";

type TenderRow = { id: string; title: string; status: string; created_at: string };

export default function Dashboard() {
  const [title, setTitle] = useState("Construction services — eligibility screening");
  const [description, setDescription] = useState("Hackathon demo tender");
  const [rows, setRows] = useState<TenderRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const data = (await apiFetch("/tenders")) as { tenders: TenderRow[] };
      setRows(data.tenders || []);
    } catch (e: unknown) {
      setErr(String(e));
    } finally {
      setLoading(false);
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
        body: JSON.stringify({ title, description }),
      });
      setTitle("");
      setDescription("");
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
            <div style={{ height: 10 }} />
            <label>Description</label>
            <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
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

      <div className="panel" style={{ marginTop: 24 }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
          <h2>Active Tenders</h2>
          <span className="badge ok">{rows.length} Total</span>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>Title</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={3} style={{ textAlign: "center", padding: 40 }} className="muted">
                  Loading tenders…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={3} style={{ textAlign: "center", padding: 40 }} className="muted">
                  No active tenders found. Create your first workspace above.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>{r.title}</td>
                  <td>
                    <span className={`badge ${r.status === "open" ? "ok" : "review"}`}>{r.status}</span>
                  </td>
                  <td>
                    <Link to={`/tender/${r.id}`}>
                      <button className="ghost" style={{ padding: "6px 12px", fontSize: "0.85rem" }}>
                        Open Workspace →
                      </button>
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
