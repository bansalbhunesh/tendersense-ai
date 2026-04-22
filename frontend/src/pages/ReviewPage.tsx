import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../api";

type Item = {
  id: string;
  tender_id: string;
  bidder_id: string;
  criterion_id: string;
  tender_title?: string;
  bidder_name?: string;
  payload: Record<string, unknown>;
};

export default function ReviewPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [audit, setAudit] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [queueFilter, setQueueFilter] = useState("");
  const [selectedItem, setSelectedItem] = useState<Item | null>(null);
  const [tenderId, setTenderId] = useState("");
  const [bidderId, setBidderId] = useState("");
  const [criterionId, setCriterionId] = useState("");
  const [verdict, setVerdict] = useState("ELIGIBLE");
  const [why, setWhy] = useState("Verified against original CA certificate on file.");
  const [msg, setMsg] = useState<string | null>(null);
  const selectedCriterionLabel =
    selectedItem && selectedItem.payload
      ? String(
          selectedItem.payload.text_raw ||
            selectedItem.payload.field ||
            selectedItem.payload.criterion_text ||
            selectedItem.criterion_id,
        )
      : "";

  async function load() {
    setLoading(true);
    try {
      const q = (await apiFetch("/review/queue")) as { items: Item[] };
      setItems(q.items || []);
      const a = (await apiFetch("/audit")) as { entries: Record<string, unknown>[] };
      setAudit(a.entries || []);
    } finally {
      setLoading(false);
    }
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
          <input
            placeholder="Filter by tender, bidder, criterion"
            value={queueFilter}
            onChange={(e) => setQueueFilter(e.target.value)}
          />
          <div style={{ height: 10 }} />
          {loading && <p className="muted">Loading review queue…</p>}
          {items.length === 0 && <p className="muted">No open review items.</p>}
          {items
            .filter((it) => {
              const q = queueFilter.trim().toLowerCase();
              if (!q) return true;
              return (
                String(it.tender_title || it.tender_id).toLowerCase().includes(q) ||
                String(it.bidder_name || it.bidder_id).toLowerCase().includes(q) ||
                String(it.criterion_id).toLowerCase().includes(q)
              );
            })
            .map((it) => (
            <div key={it.id} className="panel" style={{ marginTop: 10 }}>
              <div style={{ fontWeight: 700 }}>{it.tender_title || `Tender ${it.tender_id.slice(0, 8)}…`}</div>
              <div className="muted">Bidder: {it.bidder_name || it.bidder_id.slice(0, 8)}</div>
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
                Context: {selectedItem.tender_title || selectedItem.tender_id.slice(0, 8)} · {selectedItem.bidder_name || selectedItem.bidder_id.slice(0, 8)} · criterion {selectedItem.criterion_id}
              </div>
              <div className="muted" style={{ marginBottom: 8 }}>
                Criterion: {selectedCriterionLabel}
              </div>
              <pre className="mono" style={{ margin: 0, whiteSpace: "pre-wrap" }}>
                {JSON.stringify(selectedItem.payload, null, 2)}
              </pre>
            </div>
          )}
          <form onSubmit={submitOverride}>
            <label>Tender ID</label>
            <input value={tenderId} onChange={(e) => setTenderId(e.target.value)} required readOnly={!!selectedItem} />
            <div style={{ height: 10 }} />
            <label>Bidder ID</label>
            <input value={bidderId} onChange={(e) => setBidderId(e.target.value)} required readOnly={!!selectedItem} />
            <div style={{ height: 10 }} />
            <label>Criterion ID</label>
            <input value={criterionId} onChange={(e) => setCriterionId(e.target.value)} required readOnly={!!selectedItem} />
            {selectedItem && (
              <p className="muted" style={{ marginTop: 6 }}>
                IDs are locked to the selected queue item to prevent accidental overrides.
              </p>
            )}
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
            {selectedItem && (
              <button
                className="ghost"
                type="button"
                style={{ marginLeft: 8 }}
                onClick={() => {
                  setSelectedItem(null);
                  setTenderId("");
                  setBidderId("");
                  setCriterionId("");
                }}
              >
                Clear selection
              </button>
            )}
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
