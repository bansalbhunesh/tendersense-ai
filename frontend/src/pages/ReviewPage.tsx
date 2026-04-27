import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { apiFetch } from "../api";
import AppHeader from "../components/AppHeader";
import { useToast } from "../components/ToastProvider";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

type EvidenceSnippet = {
  document?: string;
  evidence_quote?: string;
  extracted_value?: string;
  source?: string;
};

type QueuePayload = {
  text_raw?: string;
  field?: string;
  criterion_text?: string;
  verdict?: string;
  ai_verdict?: string;
  confidence?: number;
  reasoning?: string;
  reason?: string;
  evidence?: EvidenceSnippet[] | EvidenceSnippet;
  evidence_snapshot?: EvidenceSnippet;
};

type Item = {
  id: string;
  tender_id: string;
  bidder_id: string;
  criterion_id: string;
  tender_title?: string;
  bidder_name?: string;
  payload: QueuePayload & Record<string, unknown>;
};

type AuditEntry = Record<string, unknown> & {
  id?: string | number;
  created_at?: string;
  action?: string;
  checksum?: string;
};

const VERDICT_OPTIONS = ["ELIGIBLE", "NOT_ELIGIBLE", "NEEDS_REVIEW"] as const;

function aiVerdict(p: QueuePayload | undefined): string {
  return String(p?.ai_verdict || p?.verdict || "NEEDS_REVIEW");
}

function aiConfidence(p: QueuePayload | undefined): number | null {
  if (!p) return null;
  if (typeof p.confidence === "number") return p.confidence;
  return null;
}

function aiReasoning(p: QueuePayload | undefined): string {
  return String(p?.reasoning || p?.reason || "");
}

function evidenceList(p: QueuePayload | undefined): EvidenceSnippet[] {
  if (!p) return [];
  if (Array.isArray(p.evidence)) return p.evidence;
  if (p.evidence && typeof p.evidence === "object") return [p.evidence as EvidenceSnippet];
  if (p.evidence_snapshot) return [p.evidence_snapshot];
  return [];
}

function criterionTitle(item: Item): string {
  const p = item.payload || {};
  return String(p.text_raw || p.field || p.criterion_text || item.criterion_id);
}

function verdictBadgeClass(v: string): string {
  if (v === "ELIGIBLE" || v === "PASS") return "ok";
  if (v === "NOT_ELIGIBLE" || v === "FAIL") return "bad";
  return "review";
}

export default function ReviewPage() {
  useDocumentTitle("Review queue · TenderSense AI");
  const toast = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [queueFilter, setQueueFilter] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [verdict, setVerdict] = useState<string>("ELIGIBLE");
  const [why, setWhy] = useState("Verified against original CA certificate on file.");
  const [submitting, setSubmitting] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const q = (await apiFetch("/review/queue")) as { items: Item[] };
      setItems(q.items || []);
      const a = (await apiFetch("/audit")) as { entries: AuditEntry[] };
      setAudit(a.entries || []);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      toast.error(`Failed to load review queue: ${message}`);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filteredItems = useMemo(() => {
    const q = queueFilter.trim().toLowerCase();
    if (!q) return items;
    return items.filter(
      (it) =>
        String(it.tender_title || it.tender_id).toLowerCase().includes(q) ||
        String(it.bidder_name || it.bidder_id).toLowerCase().includes(q) ||
        String(it.criterion_id).toLowerCase().includes(q),
    );
  }, [items, queueFilter]);

  const selected = useMemo(
    () => items.find((it) => it.id === selectedId) || null,
    [items, selectedId],
  );

  async function submitOverride(e: FormEvent) {
    e.preventDefault();
    if (!selected) {
      toast.error("Pick a queue item before recording an override.");
      return;
    }
    if (!why.trim()) {
      toast.error("Justification is required.");
      return;
    }
    setSubmitting(true);
    try {
      await apiFetch("/review/override", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tender_id: selected.tender_id,
          bidder_id: selected.bidder_id,
          criterion_id: selected.criterion_id,
          new_verdict: verdict,
          justification: why,
        }),
      });
      toast.success("Override recorded — checksum appended to audit log.");
      // Optimistically remove the item from the local queue.
      setItems((prev) => prev.filter((it) => it.id !== selected.id));
      setSelectedId(null);
      // Refresh audit log so the new entry shows up.
      try {
        const a = (await apiFetch("/audit")) as { entries: AuditEntry[] };
        setAudit(a.entries || []);
      } catch {
        /* non-fatal */
      }
    } catch (ex: unknown) {
      const message = ex instanceof Error ? ex.message : String(ex);
      toast.error(`Override failed: ${message}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="shell">
      <AppHeader
        left={
          <>
            <Link to="/app" className="ghost" style={{ textDecoration: "none" }}>
              ← Dashboard
            </Link>
            <strong style={{ marginLeft: 12 }}>Human-in-the-loop review</strong>
          </>
        }
      />

      <div className="grid2">
        <div className="panel">
          <h2>Queue</h2>
          <input
            placeholder="Filter by tender, bidder, criterion"
            value={queueFilter}
            onChange={(e) => setQueueFilter(e.target.value)}
            data-testid="review-filter"
          />
          <div style={{ height: 10 }} />
          {loading && <p className="muted">Loading review queue…</p>}
          {!loading && filteredItems.length === 0 && (
            <p className="muted" data-testid="review-empty">
              No open review items.
            </p>
          )}
          <div data-testid="review-queue-list">
            {filteredItems.map((it) => {
              const v = aiVerdict(it.payload);
              const conf = aiConfidence(it.payload);
              const isActive = selectedId === it.id;
              return (
                <button
                  type="button"
                  key={it.id}
                  data-testid={`review-item-${it.id}`}
                  onClick={() => {
                    setSelectedId(it.id);
                    setVerdict("ELIGIBLE");
                  }}
                  className="panel"
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    marginTop: 10,
                    padding: 14,
                    cursor: "pointer",
                    borderColor: isActive ? "var(--saffron)" : undefined,
                    boxShadow: isActive ? "0 0 0 2px var(--saffron-glow)" : undefined,
                  }}
                >
                  <div style={{ fontWeight: 700 }}>
                    {it.tender_title || `Tender ${it.tender_id.slice(0, 8)}…`}
                  </div>
                  <div className="muted" style={{ fontSize: "0.85rem" }}>
                    Bidder: {it.bidder_name || it.bidder_id.slice(0, 8)}
                  </div>
                  <div className="mono" style={{ fontSize: "0.75rem" }}>
                    criterion {it.criterion_id.slice(0, 12)}…
                  </div>
                  <div className="row" style={{ marginTop: 8, justifyContent: "space-between" }}>
                    <span className={`badge ${verdictBadgeClass(v)}`}>{v.replace(/_/g, " ")}</span>
                    {conf != null && (
                      <span className="mono muted" style={{ fontSize: "0.7rem" }}>
                        conf {(conf * 100).toFixed(0)}%
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="panel">
          <h2>Reviewer override</h2>
          <p className="muted">Every override is hashed and appended immutably for procurement audit.</p>
          {!selected && (
            <p className="muted" data-testid="review-detail-empty" style={{ marginTop: 16 }}>
              Pick an item from the queue on the left to view criterion text, AI reasoning, and supporting evidence.
            </p>
          )}
          {selected && (
            <div data-testid="review-detail">
              <div className="panel" style={{ marginBottom: 12 }}>
                <div className="mono" style={{ marginBottom: 8, fontSize: "0.8rem" }}>
                  {selected.tender_title || selected.tender_id.slice(0, 8)} ·{" "}
                  {selected.bidder_name || selected.bidder_id.slice(0, 8)} · criterion{" "}
                  {selected.criterion_id.slice(0, 12)}…
                </div>
                <div style={{ marginBottom: 10 }}>
                  <strong>Criterion</strong>
                  <p className="muted" style={{ marginTop: 4 }}>
                    {criterionTitle(selected)}
                  </p>
                </div>
                <div className="row" style={{ marginBottom: 10, gap: 8 }}>
                  <span className={`badge ${verdictBadgeClass(aiVerdict(selected.payload))}`}>
                    AI: {aiVerdict(selected.payload).replace(/_/g, " ")}
                  </span>
                  {aiConfidence(selected.payload) != null && (
                    <span className="mono muted" style={{ fontSize: "0.75rem" }}>
                      confidence {(Number(aiConfidence(selected.payload)) * 100).toFixed(1)}%
                    </span>
                  )}
                </div>
                {aiReasoning(selected.payload) && (
                  <div style={{ marginBottom: 10 }}>
                    <strong>AI reasoning</strong>
                    <p className="muted" style={{ marginTop: 4, fontSize: "0.9rem" }}>
                      {aiReasoning(selected.payload)}
                    </p>
                  </div>
                )}
                <div>
                  <strong>Evidence</strong>
                  {evidenceList(selected.payload).length === 0 ? (
                    <p className="muted" data-testid="review-evidence-empty" style={{ marginTop: 4, fontSize: "0.9rem" }}>
                      No evidence snippets attached to this queue item.
                    </p>
                  ) : (
                    <ul style={{ marginTop: 4, paddingLeft: 18 }}>
                      {evidenceList(selected.payload).map((ev, i) => (
                        <li key={i} className="mono" style={{ fontSize: "0.8rem", marginTop: 6 }}>
                          {ev.document && <strong>{ev.document}: </strong>}
                          “{ev.evidence_quote || ev.extracted_value || ev.source || ""}”
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          )}

          <form onSubmit={submitOverride}>
            <label>New verdict</label>
            <select
              data-testid="override-verdict"
              value={verdict}
              onChange={(e) => setVerdict(e.target.value)}
              disabled={!selected}
            >
              {VERDICT_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <div style={{ height: 10 }} />
            <label>Justification (required)</label>
            <textarea
              data-testid="override-justification"
              rows={4}
              value={why}
              onChange={(e) => setWhy(e.target.value)}
              required
              disabled={!selected}
            />
            <div style={{ height: 12 }} />
            <button
              className="primary"
              type="submit"
              data-testid="override-submit"
              disabled={!selected || submitting}
            >
              {submitting ? "Recording…" : "Record override"}
            </button>
            {selected && (
              <button
                className="ghost"
                type="button"
                style={{ marginLeft: 8 }}
                onClick={() => setSelectedId(null)}
              >
                Clear selection
              </button>
            )}
          </form>
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
                <td className="mono">{new Date(String(e.created_at)).toLocaleString()}</td>
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
