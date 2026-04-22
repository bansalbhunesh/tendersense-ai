import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { apiFetch, apiUpload } from "../api";
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
  const [msgType, setMsgType] = useState<"info" | "success" | "warning" | "error">("info");
  const [pageLoading, setPageLoading] = useState(true);
  const [evalElapsed, setEvalElapsed] = useState(0);
  const [evalRunning, setEvalRunning] = useState(false);
  const [evalJobId, setEvalJobId] = useState<string | null>(null);
  const [resultsVerdictFilter, setResultsVerdictFilter] = useState<"ALL" | "ELIGIBLE" | "NOT_ELIGIBLE" | "NEEDS_REVIEW">(
    "ALL",
  );
  const [resultsSearch, setResultsSearch] = useState("");

  async function refresh(opts?: { silent?: boolean }): Promise<{ criteriaCount: number; bidderCount: number }> {
    if (!opts?.silent) setPageLoading(true);
    try {
      const [t, b, r] = (await Promise.all([
        apiFetch(`/tenders/${tenderId}`),
        apiFetch(`/tenders/${tenderId}/bidders`),
        apiFetch(`/tenders/${tenderId}/results`).catch(() => null),
      ])) as [Record<string, unknown>, { bidders: { id: string; name: string }[] }, { decisions: Record<string, unknown>[]; graph: Record<string, unknown> | null } | null];
      setTender(t);
      const bl = b?.bidders || [];
      setBidders(bl);
      if (r) {
        setResults({
          decisions: (r.decisions || []) as Decision[],
          graph: r.graph,
        });
      } else {
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
    setMsgType("info");
    const fd = new FormData();
    fd.append("file", input.files[0]);
    try {
      const j = (await apiUpload(`/tenders/${tenderId}/documents`, fd)) as {
        ocr?: { text?: string; quality_score?: number };
        criteria_extracted?: number;
      };
      const { criteriaCount } = await refresh();
      const ocr = j.ocr || {};
      const textLen = String(ocr.text || "").trim().length;
      const qs = Number(ocr.quality_score ?? 0);
      const extracted = Number(j.criteria_extracted ?? 0);
      if (textLen < 40 || qs < 0.12) {
        setMsgType("warning");
        setMsg(
          `Saved, but OCR text is sparse (${textLen} chars, quality ${qs.toFixed(2)}). Criteria in workspace: ${criteriaCount}. Try a text-based PDF or higher-resolution scans.`,
        );
      } else {
        setMsgType("success");
        setMsg(
          `Processed: ${extracted} new criteria rows from this upload; ${criteriaCount} total criteria in workspace (OCR quality ${qs.toFixed(2)}).`,
        );
      }
    } catch (ex: unknown) {
      setMsgType("error");
      setMsg(String(ex));
    } finally {
      setBusy(false);
    }
  }

  async function addBidder(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setMsgType("info");
    try {
      await apiFetch(`/tenders/${tenderId}/bidders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: bname }),
      });
      setBname(`Bidder ${bidders.length + 2}`);
      await refresh();
    } catch (ex: unknown) {
      setMsgType("error");
      setMsg(String(ex));
    } finally {
      setBusy(false);
    }
  }

  async function uploadBidderDoc(bidderId: string, file: File, docType: string) {
    setBusy(true);
    setMsg(null);
    setMsgType("info");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("doc_type", docType);
    try {
      await apiUpload(`/bidders/${bidderId}/documents`, fd);
      await refresh();
      setMsg("Bidder document OCR complete.");
    } catch (ex: unknown) {
      setMsgType("error");
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
    const startedAt = Date.now();
    setBusy(true);
    setMsg(null);
    setMsgType("info");
    setEvalElapsed(0);
    setEvalRunning(true);
    try {
      const { criteriaCount, bidderCount } = await refresh({ silent: true });
      if (criteriaCount === 0) {
        setMsgType("warning");
        setMsg("No criteria in this tender yet. Upload a tender document with extractable text first.");
        setTab("docs");
        setEvalRunning(false);
        return;
      }
      if (bidderCount === 0) {
        setMsgType("warning");
        setMsg("Register at least one bidder before running evaluation.");
        setTab("bidders");
        setEvalRunning(false);
        return;
      }
      const queued = (await apiFetch(`/tenders/${tenderId}/evaluate`, { method: "POST" })) as {
        job_id: string;
        status: string;
      };
      setEvalJobId(queued.job_id);
      let attempts = 0;
      while (attempts < 300) {
        attempts += 1;
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        const st = (await apiFetch(`/tenders/${tenderId}/evaluate/jobs/${queued.job_id}`)) as {
          status: string;
          error?: string;
        };
        if (st.status === "completed") break;
        if (st.status === "failed") {
          throw new Error(st.error || "evaluation failed");
        }
      }
      await refresh({ silent: true });
      setTab("results");
      setMsgType("success");
      const took = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      setMsg(`Evaluation finished in ${took}s — review graph and per-criterion verdicts.`);
    } catch (ex: unknown) {
      setMsgType("error");
      setMsg(String(ex));
    } finally {
      setEvalRunning(false);
      setEvalJobId(null);
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!evalRunning) return;
    const t = window.setInterval(() => setEvalElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(t);
  }, [evalRunning]);

  useEffect(() => {
    if (!msg) return;
    const t = window.setTimeout(() => setMsg(null), 8000);
    return () => window.clearTimeout(t);
  }, [msg]);

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

  const filteredDecisions = useMemo(() => {
    const needle = resultsSearch.trim().toLowerCase();
    return (results?.decisions || []).filter((d) => {
      const verdict = String(d.verdict || "");
      if (resultsVerdictFilter !== "ALL" && verdict !== resultsVerdictFilter) return false;
      if (!needle) return true;
      const cid = String(d.criterion_id || "").toLowerCase();
      const reason = String(d.reasoning || d.reason || "").toLowerCase();
      return cid.includes(needle) || reason.includes(needle);
    });
  }, [results, resultsVerdictFilter, resultsSearch]);

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
        <div
          className="panel"
          style={{
            marginBottom: 14,
            borderColor:
              msgType === "error"
                ? "rgba(239,68,68,0.45)"
                : msgType === "success"
                  ? "rgba(16,185,129,0.45)"
                  : msgType === "warning"
                    ? "rgba(245,158,11,0.45)"
                    : "rgba(59,130,246,0.35)",
          }}
        >
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <span className="mono">{msg}</span>
            <button className="ghost" type="button" onClick={() => setMsg(null)}>
              Dismiss
            </button>
          </div>
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
            {evalRunning ? "Running…" : busy ? "Checking prerequisites…" : "Run decision engine"}
          </button>
          {evalRunning && (
            <p className="muted" style={{ marginTop: 8 }}>
              Evaluation in progress… elapsed {evalElapsed}s
            </p>
          )}
          {evalRunning && evalJobId && (
            <p className="mono muted" style={{ marginTop: 4 }}>
              Job: {evalJobId}
            </p>
          )}
        </div>
      )}

      {tab === "results" && (
        <div className="grid2">
          <div className="panel">
            <h2>Verdict matrix</h2>
            <div className="row" style={{ marginBottom: 10 }}>
              <select
                value={resultsVerdictFilter}
                onChange={(e) =>
                  setResultsVerdictFilter(
                    e.target.value as "ALL" | "ELIGIBLE" | "NOT_ELIGIBLE" | "NEEDS_REVIEW",
                  )
                }
                style={{ maxWidth: 220 }}
              >
                <option value="ALL">All verdicts</option>
                <option value="ELIGIBLE">Eligible</option>
                <option value="NOT_ELIGIBLE">Not eligible</option>
                <option value="NEEDS_REVIEW">Needs review</option>
              </select>
              <input
                placeholder="Search criterion/reasoning"
                value={resultsSearch}
                onChange={(e) => setResultsSearch(e.target.value)}
                style={{ minWidth: 260 }}
              />
            </div>
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
                  const notEligible = vals.filter((v) => v.verdict === "NOT_ELIGIBLE").length;
                  const bidderLabel = bidderNameMap.get(bid) || `${bid.slice(0, 8)}…`;
                  return (
                    <tr key={bid}>
                      <td title={bid}>
                        <span style={{ fontWeight: 600 }}>{bidderLabel}</span>
                      </td>
                      <td>
                        {eligible} eligible · {notEligible} not eligible · {review} need review · {vals.length} criteria
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <h3 style={{ marginTop: 16 }}>Criterion-level detail</h3>
            {filteredDecisions.map((d, idx) => {
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
