import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiFetch } from "../api";
import ReasoningGraph from "../components/ReasoningGraph";

type Decision = Record<string, unknown> & {
  verdict?: string;
  criterion_id?: string;
  reasoning?: string;
  reason?: string;
  confidence?: number;
  evidence_snapshot?: { document?: string; evidence_quote?: string; extracted_value?: string };
};

export default function TenderWorkspace() {
  const { id } = useParams();
  const tenderId = id!;
  const [tab, setTab] = useState<"docs" | "bidders" | "run" | "results">("docs");
  const [tender, setTender] = useState<Record<string, unknown> | null>(null);
  const [bname, setBname] = useState("Demo Bidder Pvt Ltd");
  const [bidders, setBidders] = useState<{ id: string; name: string }[]>([]);
  const [results, setResults] = useState<{ decisions: Decision[]; graph: Record<string, unknown> | null } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pageLoading, setPageLoading] = useState(true);

  async function refresh(opts?: { silent?: boolean }): Promise<{ criteriaCount: number; bidderCount: number }> {
    if (!opts?.silent) setPageLoading(true);
    try {
      const t = (await apiFetch(`/tenders/${tenderId}`)) as Record<string, unknown>;
      setTender(t);
      const b = (await apiFetch(`/tenders/${tenderId}/bidders`)) as { bidders: { id: string; name: string }[] };
      const bl = b.bidders || [];
      setBidders(bl);
      try {
        const r = (await apiFetch(`/tenders/${tenderId}/results`)) as {
          decisions: Record<string, unknown>[];
          graph: Record<string, unknown> | null;
        };
        setResults({
          decisions: (r.decisions || []) as Decision[],
          graph: r.graph,
        });
      } catch {
        setResults(null);
      }
      const crit = ((t.criteria as unknown[]) || []).length;
      return { criteriaCount: crit, bidderCount: bl.length };
    } finally {
      if (!opts?.silent) setPageLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [tenderId]);

  async function uploadTenderDoc(e: FormEvent) {
    e.preventDefault();
    const input = (e.target as HTMLFormElement).elements.namedItem("file") as HTMLInputElement;
    if (!input.files?.[0]) return;
    setBusy(true);
    setMsg(null);
    const fd = new FormData();
    fd.append("file", input.files[0]);
    try {
      const j = (await fetch(`/api/v1/tenders/${tenderId}/documents`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("ts_token")}` },
        body: fd,
      }).then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      })) as { ocr?: { text?: string; quality_score?: number }; criteria_extracted?: number };
      const { criteriaCount } = await refresh();
      const ocr = j.ocr || {};
      const textLen = String(ocr.text || "").trim().length;
      const qs = Number(ocr.quality_score ?? 0);
      const extracted = Number(j.criteria_extracted ?? 0);
      if (textLen < 40 || qs < 0.12) {
        setMsg(
          `Saved, but OCR text is sparse (${textLen} chars, quality ${qs.toFixed(2)}). Criteria in workspace: ${criteriaCount}. Try a text-based PDF or higher-resolution scans.`,
        );
      } else {
        setMsg(
          `Processed: ${extracted} new criteria rows from this upload; ${criteriaCount} total criteria in workspace (OCR quality ${qs.toFixed(2)}).`,
        );
      }
    } catch (ex: unknown) {
      setMsg(String(ex));
    } finally {
      setBusy(false);
    }
  }

  async function addBidder(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      await apiFetch(`/tenders/${tenderId}/bidders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: bname }),
      });
      setBname(`Bidder ${bidders.length + 2}`);
      await refresh();
    } catch (ex: unknown) {
      setMsg(String(ex));
    } finally {
      setBusy(false);
    }
  }

  async function uploadBidderDoc(bidderId: string, file: File, docType: string) {
    setBusy(true);
    setMsg(null);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("doc_type", docType);
    try {
      await fetch(`/api/v1/bidders/${bidderId}/documents`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localStorage.getItem("ts_token")}` },
        body: fd,
      }).then(async (r) => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      });
      await refresh();
      setMsg("Bidder document OCR complete.");
    } catch (ex: unknown) {
      setMsg(String(ex));
    } finally {
      setBusy(false);
    }
  }

  const bidderNameMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of bidders) m.set(b.id, b.name);
    return m;
  }, [bidders]);

  const criteriaList = useMemo(() => (tender?.criteria as unknown[]) || [], [tender]);

  const criterionLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const raw of criteriaList) {
      const c = raw as Record<string, unknown>;
      const id = String(c.id || "");
      if (!id) continue;
      const label = String(c.text_raw || c.field || id);
      m.set(id, label.length > 120 ? `${label.slice(0, 117)}…` : label);
    }
    return m;
  }, [criteriaList]);

  async function runEval() {
    setBusy(true);
    setMsg(null);
    try {
      const { criteriaCount, bidderCount } = await refresh({ silent: true });
      if (criteriaCount === 0) {
        setMsg("No criteria in this tender yet. Upload a tender document with extractable text first.");
        setTab("docs");
        return;
      }
      if (bidderCount === 0) {
        setMsg("Register at least one bidder before running evaluation.");
        setTab("bidders");
        return;
      }
      await apiFetch(`/tenders/${tenderId}/evaluate`, { method: "POST" });
      await refresh({ silent: true });
      setTab("results");
      setMsg("Evaluation finished — review graph and per-criterion verdicts.");
    } catch (ex: unknown) {
      setMsg(String(ex));
    } finally {
      setBusy(false);
    }
  }

  const matrix = useMemo(() => {
    if (!results?.decisions?.length) return [];
    const map = new Map<string, Record<string, Decision>>();
    for (const raw of results.decisions) {
      const d = raw as Decision;
      const bid = String(d.bidder_id || "");
      const cid = String(d.criterion_id || "");
      if (!map.has(bid)) map.set(bid, {});
      map.get(bid)![cid] = d;
    }
    return Array.from(map.entries());
  }, [results]);

  return (
    <div className="shell">
      <div className="topbar">
        <div className="brand">
          <Link to="/app" className="ghost" style={{ textDecoration: "none" }}>
            ← Back
          </Link>
          <strong style={{ marginLeft: 12 }}>{String(tender?.title || "Tender")}</strong>
        </div>
        <Link to="/review">
          <button className="ghost">Review queue</button>
        </Link>
      </div>

      <div className="tabs">
        {(["docs", "bidders", "run", "results"] as const).map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {t === "docs" && "Tender documents"}
            {t === "bidders" && "Bidders & evidence"}
            {t === "run" && "Run evaluation"}
            {t === "results" && "Results & graph"}
          </button>
        ))}
      </div>

      {pageLoading && (
        <p className="muted" style={{ marginBottom: 12 }}>
          Loading tender workspace…
        </p>
      )}

      {msg && (
        <div className="panel" style={{ marginBottom: 14, borderColor: "rgba(255,153,51,0.35)" }}>
          <span className="mono">{msg}</span>
        </div>
      )}

      {tab === "docs" && (
        <div className="panel">
          <h2>Upload tender PDF</h2>
          <p className="muted">
            Native text PDFs extract immediately; scanned PDFs should be uploaded as images for Paddle/Tesseract in
            the AI worker. Criteria extraction runs automatically on OCR text.
          </p>
          <form onSubmit={uploadTenderDoc}>
            <input type="file" name="file" accept=".pdf,.png,.jpg,.jpeg" />
            <div style={{ height: 12 }} />
            <button className="primary" disabled={busy} type="submit">
              Upload & extract
            </button>
          </form>
          <div style={{ height: 16 }} />
          <h3>Extracted criteria ({criteriaList.length})</h3>
          {criteriaList.map((raw, i) => {
            const c = raw as Record<string, unknown>;
            const id = String(c.id || "");
            const field = String(c.field || "—");
            const op = String(c.operator || "");
            const val = c.value != null ? String(c.value) : "—";
            const rawText = String(c.text_raw || "").slice(0, 280);
            return (
              <div key={id || i} className="panel" style={{ marginTop: 10 }}>
                <div className="row" style={{ justifyContent: "space-between", gap: 12 }}>
                  <strong>{field}</strong>
                  <span className="mono muted" style={{ fontSize: "0.75rem" }}>
                    {id.slice(0, 8)}…
                  </span>
                </div>
                <p className="muted" style={{ marginTop: 6, marginBottom: 4 }}>
                  {op} <span className="mono">{val}</span>
                  {String(c.unit || "") ? ` ${String(c.unit)}` : ""}
                </p>
                {rawText && (
                  <p className="mono" style={{ fontSize: "0.85rem", opacity: 0.9 }}>
                    {rawText}
                    {String(c.text_raw || "").length > 280 ? "…" : ""}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}

      {tab === "bidders" && (
        <div className="grid2">
          <div className="panel">
            <h2>Register bidder</h2>
            <form onSubmit={addBidder}>
              <label>Legal name</label>
              <input value={bname} onChange={(e) => setBname(e.target.value)} required />
              <div style={{ height: 12 }} />
              <button className="primary" type="submit" disabled={busy}>
                Add bidder
              </button>
            </form>
          </div>
          <div className="panel">
            <h2>Evidence uploads</h2>
            <p className="muted">Attach balance sheets, GST certificates, experience letters. Doc type drives source priority.</p>
            {bidders.map((b) => (
              <div key={b.id} style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                <div style={{ fontWeight: 700 }}>{b.name}</div>
                <div className="row" style={{ marginTop: 8 }}>
                  <label style={{ flex: 1 }}>
                    CA / financial
                    <input
                      type="file"
                      onChange={(e) => e.target.files && uploadBidderDoc(b.id, e.target.files[0], "ca_certificate")}
                    />
                  </label>
                  <label style={{ flex: 1 }}>
                    GST
                    <input
                      type="file"
                      onChange={(e) => e.target.files && uploadBidderDoc(b.id, e.target.files[0], "gst_certificate")}
                    />
                  </label>
                  <label style={{ flex: 1 }}>
                    Audited balance sheet
                    <input
                      type="file"
                      onChange={(e) =>
                        e.target.files && uploadBidderDoc(b.id, e.target.files[0], "audited_balance_sheet")
                      }
                    />
                  </label>
                </div>
                <div className="row" style={{ marginTop: 8 }}>
                  <label style={{ flex: 1 }}>
                    ITR
                    <input type="file" onChange={(e) => e.target.files && uploadBidderDoc(b.id, e.target.files[0], "itr")} />
                  </label>
                  <label style={{ flex: 1 }}>
                    ISO certificate
                    <input
                      type="file"
                      onChange={(e) => e.target.files && uploadBidderDoc(b.id, e.target.files[0], "iso_certificate")}
                    />
                  </label>
                  <label style={{ flex: 1 }}>
                    Work order
                    <input
                      type="file"
                      onChange={(e) => e.target.files && uploadBidderDoc(b.id, e.target.files[0], "work_order")}
                    />
                  </label>
                </div>
                <div className="row" style={{ marginTop: 8 }}>
                  <label style={{ flex: 1 }}>
                    Experience letters
                    <input
                      type="file"
                      onChange={(e) =>
                        e.target.files && uploadBidderDoc(b.id, e.target.files[0], "experience_letters")
                      }
                    />
                  </label>
                  <label style={{ flex: 1 }}>
                    Bank statement
                    <input
                      type="file"
                      onChange={(e) => e.target.files && uploadBidderDoc(b.id, e.target.files[0], "bank_statement")}
                    />
                  </label>
                  <label style={{ flex: 1 }}>
                    Technical brochure
                    <input
                      type="file"
                      onChange={(e) =>
                        e.target.files && uploadBidderDoc(b.id, e.target.files[0], "technical_brochure")
                      }
                    />
                  </label>
                </div>
              </div>
            ))}
            {bidders.length === 0 && <p className="muted">Add at least one bidder.</p>}
          </div>
        </div>
      )}

      {tab === "run" && (
        <div className="panel">
          <h2>Evaluate all bidders</h2>
          <p className="muted">
            Runs cross-document validation, confidence-weighted operator checks, and builds the reasoning graph.
            NEEDS_REVIEW never silently disqualifies — it routes to the officer queue.
          </p>
          <p className="muted" style={{ marginTop: 8 }}>
            Criteria loaded: {criteriaList.length} · Bidders: {bidders.length}
          </p>
          <button className="primary" disabled={busy} onClick={runEval}>
            {busy ? "Running…" : "Run decision engine"}
          </button>
        </div>
      )}

      {tab === "results" && (
        <div className="grid2">
          <div className="panel">
            <h2>Verdict matrix</h2>
            <table className="table">
              <thead>
                <tr>
                  <th>Bidder</th>
                  <th>Summary</th>
                </tr>
              </thead>
              <tbody>
                {matrix.map(([bid, byC]) => {
                  const vals = Object.values(byC);
                  const eligible = vals.filter((v) => v.verdict === "ELIGIBLE").length;
                  const review = vals.filter((v) => v.verdict === "NEEDS_REVIEW").length;
                  const bidderLabel = bidderNameMap.get(bid) || `${bid.slice(0, 8)}…`;
                  return (
                    <tr key={bid}>
                      <td title={bid}>
                        <span style={{ fontWeight: 600 }}>{bidderLabel}</span>
                        <div className="mono muted" style={{ fontSize: "0.75rem" }}>
                          {bid.slice(0, 8)}…
                        </div>
                      </td>
                      <td>
                        {eligible} eligible · {review} need review · {vals.length} criteria
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <h3 style={{ marginTop: 16 }}>Criterion-level detail</h3>
            {results?.decisions?.map((d, idx) => {
              const dd = d as Decision;
              const v = String(dd.verdict || "");
              const cls = v === "ELIGIBLE" ? "ok" : v === "NOT_ELIGIBLE" ? "bad" : "review";
              const cid = String(dd.criterion_id || "");
              const critTitle = criterionLabelById.get(cid) || cid;
              return (
                <div key={idx} className="panel" style={{ marginTop: 12 }}>
                  <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4, maxWidth: "75%" }}>
                      <span style={{ fontWeight: 600 }}>{critTitle}</span>
                      <span className="mono muted" style={{ fontSize: "0.75rem" }}>
                        id {cid.slice(0, 8)}…
                      </span>
                    </div>
                    <span className={`badge ${cls}`}>{v.replace(/_/g, " ")}</span>
                  </div>
                  
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 4 }}>Reasoning</div>
                    <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
                      {String(dd.reasoning || dd.reason || "No reasoning provided.")}
                    </p>
                  </div>

                  {dd.evidence_snapshot && (
                    <div style={{ background: 'rgba(0,0,0,0.2)', padding: 12, borderRadius: 8, border: '1px solid var(--border)' }}>
                      <div className="row" style={{ marginBottom: 8 }}>
                         <span className="badge review" style={{ fontSize: '0.6rem' }}>Evidence Snapshot</span>
                         <span className="mono" style={{ fontSize: '0.7rem' }}>{dd.evidence_snapshot.document}</span>
                      </div>
                      <div className="mono" style={{ fontSize: '0.75rem', color: 'var(--muted)' }}>
                        "{dd.evidence_snapshot.evidence_quote || dd.evidence_snapshot.extracted_value}"
                      </div>
                    </div>
                  )}

                  <div className="row" style={{ marginTop: 12, justifyContent: 'flex-end', opacity: 0.6 }}>
                    <span className="mono" style={{ fontSize: '0.7rem' }}>CONFIDENCE: {Number(dd.confidence || 0).toFixed(3)}</span>
                  </div>
                </div>
              );
            })}
          </div>
          <div className="panel">
            <h2>Reasoning graph</h2>
            <ReasoningGraph graph={results?.graph as { nodes: []; edges: [] } | null} />
          </div>
        </div>
      )}
    </div>
  );
}
