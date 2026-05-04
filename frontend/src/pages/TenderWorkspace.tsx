import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiFetch, apiFetchWithMeta, apiUpload } from "../api";
import AppHeader from "../components/shell/AppHeader";
import BidderScoreboard from "../components/tender/BidderScoreboard";
import ContradictionAlert from "../components/review/ContradictionAlert";
import ContradictionModal, { type ConflictData } from "../components/review/ContradictionModal";
import DecisionCard from "../components/review/DecisionCard";
import EvaluationPipeline from "../components/tender/EvaluationPipeline";
import ReasoningGraph from "../components/tender/ReasoningGraph";
import RiskScorePanel from "../components/tender/RiskScorePanel";
import { useToast } from "../components/shell/ToastProvider";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

type Decision = Record<string, unknown> & {
  verdict?: string;
  criterion_id?: string;
  reasoning?: string;
  reason?: string;
  confidence?: number;
  evidence_snapshot?: { document?: string; evidence_quote?: string; extracted_value?: string };
};

const PAGE_SIZES = [25, 50, 100] as const;

export default function TenderWorkspace() {
  const { id } = useParams();
  const tenderId = id!;
  useDocumentTitle("workspace.documentTitle");
  const { t } = useTranslation();
  const toast = useToast();
  const [tab, setTab] = useState<"docs" | "bidders" | "run" | "results">("docs");
  const [tender, setTender] = useState<Record<string, unknown> | null>(null);
  const [bname, setBname] = useState("Demo Bidder Pvt Ltd");
  const [bidders, setBidders] = useState<{ id: string; name: string }[]>([]);
  const [bidderTotal, setBidderTotal] = useState<number | null>(null);
  const [bidderPageSize, setBidderPageSize] = useState<number>(50);
  const [bidderOffset, setBidderOffset] = useState(0);
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
  const [contradictionModal, setContradictionModal] = useState<ConflictData | null>(null);
  const [justEvaled, setJustEvaled] = useState(false);

  async function refresh(opts?: { silent?: boolean }): Promise<{ criteriaCount: number; bidderCount: number }> {
    if (!opts?.silent) setPageLoading(true);
    try {
      const biddersUrl = `/tenders/${tenderId}/bidders?limit=${bidderPageSize}&offset=${bidderOffset}`;
      const [tt, bRes, r] = await Promise.all([
        apiFetch(`/tenders/${tenderId}`) as Promise<Record<string, unknown>>,
        apiFetchWithMeta<{ bidders: { id: string; name: string }[] }>(biddersUrl),
        apiFetch(`/tenders/${tenderId}/results?limit=200&offset=0`).catch(() => null) as Promise<{
          decisions: Record<string, unknown>[];
          graph: Record<string, unknown> | null;
        } | null>,
      ]);
      setTender(tt);
      const bl = bRes.data?.bidders || [];
      setBidders(bl);
      setBidderTotal(bRes.totalCount);
      if (r) {
        setResults({
          decisions: (r.decisions || []) as Decision[],
          graph: r.graph,
        });
      } else {
        setResults(null);
      }
      const crit = ((tt.criteria as unknown[]) || []).length;
      return { criteriaCount: crit, bidderCount: bl.length };
    } finally {
      if (!opts?.silent) setPageLoading(false);
    }
  }

  useEffect(() => {
    void refresh().catch((e) => {
      const message = e instanceof Error ? e.message : String(e);
      toast.error(t("workspace.loadFailed", { message }));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenderId, bidderOffset, bidderPageSize]);

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
          t("workspace.uploadSparseOcr", {
            textLen,
            qs: qs.toFixed(2),
            criteriaCount,
          }),
        );
      } else {
        setMsgType("success");
        setMsg(
          t("workspace.uploadProcessed", {
            extracted,
            criteriaCount,
            qs: qs.toFixed(2),
          }),
        );
      }
    } catch (ex: unknown) {
      const message = ex instanceof Error ? ex.message : String(ex);
      setMsgType("error");
      setMsg(message);
      toast.error(t("workspace.tenderUploadFailed", { message }));
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
      const previousName = bname;
      setBname(`Bidder ${bidders.length + 2}`);
      toast.success(t("workspace.bidderRegistered", { name: previousName }));
      await refresh();
    } catch (ex: unknown) {
      const message = ex instanceof Error ? ex.message : String(ex);
      setMsgType("error");
      setMsg(message);
      toast.error(t("workspace.addBidderFailed", { message }));
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
      setMsg(t("workspace.bidderOcrComplete"));
      toast.success(t("workspace.bidderOcrComplete"));
    } catch (ex: unknown) {
      const message = ex instanceof Error ? ex.message : String(ex);
      setMsgType("error");
      setMsg(message);
      toast.error(t("workspace.evidenceUploadFailed", { message }));
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

  const criterionDataById = useMemo(() => {
    const m = new Map<string, Record<string, unknown>>();
    for (const raw of criteriaList) {
      const c = raw as Record<string, unknown>;
      const id = String(c.id || "");
      if (id) m.set(id, c);
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
        setMsg(t("workspace.noCriteria"));
        setTab("docs");
        setEvalRunning(false);
        return;
      }
      if (bidderCount === 0) {
        setMsgType("warning");
        setMsg(t("workspace.noBidders"));
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
      let completed = false;
      while (attempts < 300) {
        attempts += 1;
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        const st = (await apiFetch(`/tenders/${tenderId}/evaluate/jobs/${queued.job_id}`)) as {
          status: string;
          error?: string;
        };
        if (st.status === "completed") {
          completed = true;
          break;
        }
        if (st.status === "failed") {
          throw new Error(st.error || "evaluation failed");
        }
      }
      if (!completed) {
        throw new Error(t("workspace.evalTimeout"));
      }
      await refresh({ silent: true });
      setTab("results");
      setMsgType("success");
      const took = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      setMsg(t("workspace.evalFinished", { seconds: took }));
      toast.success(t("workspace.evalFinishedToast", { seconds: took }));
      setJustEvaled(true);
    } catch (ex: unknown) {
      const message = ex instanceof Error ? ex.message : String(ex);
      setMsgType("error");
      setMsg(message);
      toast.error(t("workspace.evalFailed", { message }));
    } finally {
      setEvalRunning(false);
      setEvalJobId(null);
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!evalRunning) return;
    const ti = window.setInterval(() => setEvalElapsed((s) => s + 1), 1000);
    return () => window.clearInterval(ti);
  }, [evalRunning]);

  // Fire contradiction modal once after a live evaluation that found conflicts
  useEffect(() => {
    if (!justEvaled || !results) return;
    setJustEvaled(false);
    const conflict = results.decisions.find(
      (d) => String((d as Record<string, unknown>).reason) === "CONFLICT_DETECTED",
    ) as (Record<string, unknown> & Decision) | undefined;
    if (!conflict) return;
    const trace = (conflict.decision_trace as Record<string, unknown>) ?? {};
    const bid = String(conflict.bidder_id || "");
    const cid = String(conflict.criterion_id || "");
    const cData = criterionDataById.get(cid) || {};
    const snapshots = (
      (conflict.conflict_snapshots as unknown[]) ??
      (trace.conflicting_snapshots as unknown[]) ??
      []
    ) as Array<{ document: string; doc_type?: string; normalized_value: number; raw_text?: string }>;
    const delay = window.setTimeout(() => {
      setContradictionModal({
        bidderName: bidderNameMap.get(bid) || bid.slice(0, 14) || "Unknown bidder",
        criterionLabel: criterionLabelById.get(cid) || cid,
        field: String(trace.field || "financial criterion"),
        confidence: Number(conflict.confidence ?? 0.51),
        evidenceCount: Number(trace.evidence_count ?? 2),
        operator: String(cData.operator || ">="),
        threshold: Number(cData.value ?? 0),
        conflictSnapshots: snapshots,
      });
    }, 700);
    return () => window.clearTimeout(delay);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [justEvaled, results]);

  useEffect(() => {
    if (!msg) return;
    const ti = window.setTimeout(() => setMsg(null), 8000);
    return () => window.clearTimeout(ti);
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

  const showBidderPagination = bidderTotal != null;
  const canBidderPrev = bidderOffset > 0;
  const canBidderNext = bidderTotal != null && bidderOffset + bidders.length < bidderTotal;

  const tabLabels: Record<"docs" | "bidders" | "run" | "results", string> = {
    docs: t("workspace.tabDocs"),
    bidders: t("workspace.tabBidders"),
    run: t("workspace.tabRun"),
    results: t("workspace.tabResults"),
  };

  return (
    <div className="shell">
      <AppHeader
        left={
          <>
            <Link to="/app" className="link-back">
              ← {t("common.back")}
            </Link>
            <strong className="page-title-inline">{String(tender?.title || t("workspace.fallbackTitle"))}</strong>
          </>
        }
        actions={
            <Link to="/review">
              <button type="button" className="ghost">
                {t("common.reviewQueueButton")}
              </button>
            </Link>
        }
      />

      <div className="tabs">
        {(["docs", "bidders", "run", "results"] as const).map((tk) => (
          <button
            key={tk}
            data-testid={`tab-${tk}`}
            className={tab === tk ? "active" : ""}
            onClick={() => setTab(tk)}
          >
            {tabLabels[tk]}
          </button>
        ))}
      </div>

      {pageLoading && (
        <p className="muted" style={{ marginBottom: 12 }}>
          {t("workspace.loading")}
        </p>
      )}

      {msg && (
        <div
          className={`panel flash-banner ${
            msgType === "error"
              ? "flash-banner--error"
              : msgType === "success"
                ? "flash-banner--success"
                : msgType === "warning"
                  ? "flash-banner--warning"
                  : "flash-banner--info"
          }`}
        >
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <span className="mono" data-testid="workspace-msg">
              {msg}
            </span>
            <button className="ghost" type="button" onClick={() => setMsg(null)}>
              {t("common.dismiss")}
            </button>
          </div>
        </div>
      )}

      {tab === "docs" && (
        <div className="panel">
          <h2>{t("workspace.uploadTitle")}</h2>
          <p className="muted">{t("workspace.uploadCopy")}</p>
          <form onSubmit={uploadTenderDoc}>
            <input type="file" name="file" accept=".pdf,.png,.jpg,.jpeg" />
            <div style={{ height: 12 }} />
            <button className="primary" disabled={busy} type="submit">
              {t("workspace.uploadButton")}
            </button>
          </form>
          <div style={{ height: 16 }} />
          <h3>{t("workspace.extractedCriteria", { count: criteriaList.length })}</h3>
          {criteriaList.map((raw, i) => {
            const c = raw as Record<string, unknown>;
            const id = String(c.id || "");
            const field = String(c.field || "—");
            const op = String(c.operator || "");
            const val = c.value != null ? String(c.value) : "—";
            const rawText = String(c.text_raw || "").slice(0, 280);
            return (
              <div key={id || i} className="nest-card">
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
            <h2>{t("workspace.registerBidder")}</h2>
            <form onSubmit={addBidder}>
              <label>{t("workspace.legalName")}</label>
              <input value={bname} onChange={(e) => setBname(e.target.value)} required />
              <div style={{ height: 12 }} />
              <button className="primary" type="submit" disabled={busy}>
                {t("workspace.addBidder")}
              </button>
            </form>
          </div>
          <div className="panel">
            <h2>{t("workspace.evidenceUploads")}</h2>
            <p className="muted">{t("workspace.evidenceCopy")}</p>
            {bidders.map((b) => (
              <div key={b.id} style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border)" }}>
                <div style={{ fontWeight: 700 }}>{b.name}</div>
                <div className="row" style={{ marginTop: 8 }}>
                  <label style={{ flex: 1 }}>
                    {t("workspace.docCa")}
                    <input
                      type="file"
                      onChange={(e) => e.target.files && uploadBidderDoc(b.id, e.target.files[0], "ca_certificate")}
                    />
                  </label>
                  <label style={{ flex: 1 }}>
                    {t("workspace.docGst")}
                    <input
                      type="file"
                      onChange={(e) => e.target.files && uploadBidderDoc(b.id, e.target.files[0], "gst_certificate")}
                    />
                  </label>
                  <label style={{ flex: 1 }}>
                    {t("workspace.docBalance")}
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
                    {t("workspace.docItr")}
                    <input type="file" onChange={(e) => e.target.files && uploadBidderDoc(b.id, e.target.files[0], "itr")} />
                  </label>
                  <label style={{ flex: 1 }}>
                    {t("workspace.docIso")}
                    <input
                      type="file"
                      onChange={(e) => e.target.files && uploadBidderDoc(b.id, e.target.files[0], "iso_certificate")}
                    />
                  </label>
                  <label style={{ flex: 1 }}>
                    {t("workspace.docWorkOrder")}
                    <input
                      type="file"
                      onChange={(e) => e.target.files && uploadBidderDoc(b.id, e.target.files[0], "work_order")}
                    />
                  </label>
                </div>
                <div className="row" style={{ marginTop: 8 }}>
                  <label style={{ flex: 1 }}>
                    {t("workspace.docExperience")}
                    <input
                      type="file"
                      onChange={(e) =>
                        e.target.files && uploadBidderDoc(b.id, e.target.files[0], "experience_letters")
                      }
                    />
                  </label>
                  <label style={{ flex: 1 }}>
                    {t("workspace.docBank")}
                    <input
                      type="file"
                      onChange={(e) => e.target.files && uploadBidderDoc(b.id, e.target.files[0], "bank_statement")}
                    />
                  </label>
                  <label style={{ flex: 1 }}>
                    {t("workspace.docTechBrochure")}
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
            {bidders.length === 0 && <p className="muted">{t("workspace.addAtLeastOne")}</p>}

            {showBidderPagination && (
              <div
                className="row"
                data-testid="bidders-pagination"
                style={{ marginTop: 16, justifyContent: "space-between" }}
              >
                <div className="row" style={{ gap: 8, alignItems: "center" }}>
                  <label htmlFor="bidder-page-size" style={{ margin: 0 }}>{t("common.pageSize")}</label>
                  <select
                    id="bidder-page-size"
                    data-testid="bidders-page-size"
                    value={bidderPageSize}
                    onChange={(e) => {
                      setBidderPageSize(Number(e.target.value));
                      setBidderOffset(0);
                    }}
                    style={{ width: 100 }}
                  >
                    {PAGE_SIZES.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <span className="muted" style={{ fontSize: "0.85rem" }}>
                    {t("dashboard.rangeOf", {
                      start: bidderOffset + 1,
                      end: bidderOffset + bidders.length,
                      total: bidderTotal,
                    })}
                  </span>
                  <button
                    type="button"
                    className="ghost"
                    data-testid="bidders-prev"
                    disabled={!canBidderPrev}
                    onClick={() => setBidderOffset(Math.max(0, bidderOffset - bidderPageSize))}
                  >
                    {t("common.prev")}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    data-testid="bidders-next"
                    disabled={!canBidderNext}
                    onClick={() => setBidderOffset(bidderOffset + bidderPageSize)}
                  >
                    {t("common.next")}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === "run" && (
        <>
          <EvaluationPipeline
            running={evalRunning}
            elapsed={evalElapsed}
            done={results !== null && !evalRunning}
            criteriaCount={criteriaList.length}
            bidderCount={bidders.length}
          />
          <div className="panel">
          <h2>{t("workspace.evaluateAll")}</h2>
          <p className="muted">{t("workspace.evaluateCopy")}</p>
          <p className="muted" style={{ marginTop: 8 }}>
            {t("workspace.criteriaBidders", { criteria: criteriaList.length, bidders: bidders.length })}
          </p>
          <button data-testid="run-evaluate" className="primary" disabled={busy} onClick={runEval}>
            {evalRunning
              ? t("workspace.running")
              : busy
                ? t("workspace.checkingPrereqs")
                : t("workspace.runDecisionEngine")}
          </button>
          {evalRunning && (
            <p className="muted" style={{ marginTop: 8 }}>
              {t("workspace.elapsed", { elapsed: evalElapsed })}
            </p>
          )}
          {evalRunning && evalJobId && (
            <p className="mono muted" style={{ marginTop: 4 }}>
              {t("workspace.jobLabel", { job: evalJobId })}
            </p>
          )}
        </div>
        </>
      )}

      {contradictionModal && (
        <ContradictionModal
          data={contradictionModal}
          onViewAnalysis={() => {
            setContradictionModal(null);
            setTab("results");
          }}
          onDismiss={() => setContradictionModal(null)}
        />
      )}

      {tab === "results" && (
        <>
          <BidderScoreboard
            decisions={results?.decisions ?? []}
            bidders={bidders}
          />
          <RiskScorePanel decisions={results?.decisions ?? []} />
          <ContradictionAlert
            decisions={results?.decisions ?? []}
            bidderNameMap={bidderNameMap}
            criterionLabelById={criterionLabelById}
          />
          <div className="grid2">
          <div className="panel">
            <h2>{t("workspace.verdictMatrix")}</h2>
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
                <option value="ALL">{t("workspace.verdictAll")}</option>
                <option value="ELIGIBLE">{t("workspace.verdictEligible")}</option>
                <option value="NOT_ELIGIBLE">{t("workspace.verdictNotEligible")}</option>
                <option value="NEEDS_REVIEW">{t("workspace.verdictNeedsReview")}</option>
              </select>
              <input
                placeholder={t("workspace.searchCriterion")}
                value={resultsSearch}
                onChange={(e) => setResultsSearch(e.target.value)}
                style={{ minWidth: 260 }}
              />
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>{t("workspace.tableBidder")}</th>
                  <th>{t("workspace.tableSummary")}</th>
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
                        {t("workspace.summaryLine", {
                          eligible,
                          notEligible,
                          review,
                          total: vals.length,
                        })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <h3 style={{ marginTop: 16 }}>{t("workspace.criterionDetail")}</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
              {filteredDecisions.map((d, idx) => {
                const dd = d as Decision;
                const cid = String(dd.criterion_id || "");
                const critTitle = criterionLabelById.get(cid) || cid;
                return (
                  <div
                    key={idx}
                    className="decision-card-enter"
                    style={{ animationDelay: `${idx * 0.06}s` }}
                  >
                    <DecisionCard decision={dd} criterionLabel={critTitle} />
                  </div>
                );
              })}
            </div>
          </div>
          <div className="panel">
            <h2>{t("workspace.reasoningGraph")}</h2>
            <ReasoningGraph graph={results?.graph as { nodes: []; edges: [] } | null} />
          </div>
        </div>
        </>
      )}
    </div>
  );
}
