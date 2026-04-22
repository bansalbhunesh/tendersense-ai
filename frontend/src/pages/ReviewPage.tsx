import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../api";

type Item = {
  id: string;
  tender_id: string;
  bidder_id: string;
  criterion_id: string;
  payload: Record<string, unknown>;
};

export default function ReviewPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [audit, setAudit] = useState<Record<string, unknown>[]>([]);
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [tenderId, setTenderId] = useState("");
  const [bidderId, setBidderId] = useState("");
  const [criterionId, setCriterionId] = useState("");
  const [verdict, setVerdict] = useState("ELIGIBLE");
  const [why, setWhy] = useState("Verified against original CA certificate on file.");
  const [msg, setMsg] = useState<string | null>(null);

  async function load() {
    const q = (await apiFetch("/review/queue")) as { items: Item[] };
    setItems(q.items || []);
    const a = (await apiFetch("/audit")) as { entries: Record<string, unknown>[] };
    setAudit(a.entries || []);
  }

  useEffect(() => {
    load();
  }, []);

  async function submitOverride(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await apiFetch("/review/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tender_id: tenderId,
          bidder_id: bidderId,
          criterion_id: criterionId,
          new_verdict: verdict,
          justification: why,
        }),
      });
      setMsg("Override recorded — checksum appended to audit log.");
      await load();
    } catch (ex: unknown) {
      setMsg(String(ex));
    }
  }

  return (
    <div className="shell">
      <div className="topbar">
        <div className="brand">
          <Link to="/app" className="ghost" style={{ textDecoration: "none" }}>
            ← Dashboard
          </Link>
          <strong style={{ marginLeft: 12 }}>Human-in-the-loop review</strong>
        </div>
      </div>

      <div className="grid2">
        <div className="panel">
          <h2>Queue</h2>
          {items.length === 0 && <p className="muted">No open review items.</p>}
          {items.map((it) => (
            <div key={it.id} className="panel" style={{ marginTop: 10 }}>
              <div className="mono">tender {it.tender_id.slice(0, 8)}…</div>
              <div className="mono">bidder {it.bidder_id.slice(0, 8)}…</div>
              <div className="mono">criterion {it.criterion_id}</div>
              <pre className="mono" style={{ marginTop: 8 }}>
                {JSON.stringify(it.payload, null, 2)}
              </pre>
              <button
                className="ghost"
                style={{ marginTop: 8 }}
                type="button"
                onClick={() => {
                  setTenderId(it.tender_id);
                  setBidderId(it.bidder_id);
                  setCriterionId(it.criterion_id);
                  setSelectedItem(it);
                }}
              >
                Fill override form
              </button>
            </div>
          ))}
        </div>

        <div className="panel">
          <h2>Reviewer override</h2>
          <p className="muted">Every override is hashed and appended immutably for procurement audit.</p>
          {selectedItem && (
            <div className="panel" style={{ marginBottom: 12 }}>
              <div className="mono" style={{ marginBottom: 8 }}>
                Context: bidder {selectedItem.bidder_id.slice(0, 8)}… criterion {selectedItem.criterion_id}
              </div>
              <pre className="mono" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                {JSON.stringify(selectedItem.payload, null, 2)}
              </pre>
            </div>
          )}
          <form onSubmit={submitOverride}>
            <label>Tender ID</label>
            <input value={tenderId} onChange={(e) => setTenderId(e.target.value)} required />
            <div style={{ height: 10 }} />
            <label>Bidder ID</label>
            <input value={bidderId} onChange={(e) => setBidderId(e.target.value)} required />
            <div style={{ height: 10 }} />
            <label>Criterion ID</label>
            <input value={criterionId} onChange={(e) => setCriterionId(e.target.value)} required />
            <div style={{ height: 10 }} />
            <label>New verdict</label>
            <select value={verdict} onChange={(e) => setVerdict(e.target.value)}>
              <option>ELIGIBLE</option>
              <option>NOT_ELIGIBLE</option>
              <option>NEEDS_REVIEW</option>
            </select>
            <div style={{ height: 10 }} />
            <label>Justification (required)</label>
            <textarea rows={4} value={why} onChange={(e) => setWhy(e.target.value)} required />
            <div style={{ height: 12 }} />
            <button className="primary" type="submit">
              Record override
            </button>
          </form>
          {msg && <p className="muted" style={{ marginTop: 12, color: "#8fdfff" }}>{msg}</p>}
        </div>
      </div>

      <div style={{ height: 16 }} />

      <div className="panel">
        <h2>Audit log (recent)</h2>
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Action</th>
              <th>Checksum</th>
            </tr>
          </thead>
          <tbody>
            {audit.map((e) => (
              <tr key={String(e.id)}>
                <td className="mono">
                  {new Date(String(e.created_at)).toLocaleString()}
                </td>
                <td>{String(e.action)}</td>
                <td className="mono">{String(e.checksum || "").slice(0, 24)}…</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
