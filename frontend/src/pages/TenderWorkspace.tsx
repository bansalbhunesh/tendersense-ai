import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import AddCriterionForm from "../components/workspace/AddCriterionForm";
import BidderDocChecklist, { BidderDocMobileSheet, type BidderDocRow } from "../components/workspace/BidderDocChecklist";
import CriterionRow from "../components/workspace/CriterionRow";
import FileDropZone from "../components/workspace/FileDropZone";
import OnboardingProgress from "../components/workspace/OnboardingProgress";
import WorkspaceSkeleton from "../components/workspace/WorkspaceSkeleton";
import { DEMO_ACME_PDF_URL, DEMO_BETA_PDF_URL } from "../demo/demoPdfUrls";

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
  const [bidderDocuments, setBidderDocuments] = useState<Record<string, BidderDocRow[]>>({});
  const [uploadingEvidence, setUploadingEvidence] = useState<{ bidderId: string; docType: string } | null>(null);
  const [mobileSheet, setMobileSheet] = useState<{ id: string; name: string } | null>(null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [evalJobProgress, setEvalJobProgress] = useState<number | null>(null);
  const evalPollAbortRef = useRef(false);
  const bidderNameInputRef = useRef<HTMLInputElement>(null);

  const loadBidderDocuments = useCallback(
    async (bl: { id: string }[]) => {
      const entries = await Promise.all(
        bl.map(async (b) => {
          try {
            const d = (await apiFetch(`/tenders/${tenderId}/bidders/${b.id}/documents`)) as { documents: BidderDocRow[] };
            return [b.id, d.documents || []] as const;
          } catch {
            return [b.id, []] as const;
          }
        }),
      );
      setBidderDocuments(Object.fromEntries(entries));
    },
    [tenderId],
  );

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
      await loadBidderDocuments(bl);
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

  async function uploadTenderFile(file: File) {
    setBusy(true);
    setMsg(null);
    setMsgType("info");
    const fd = new FormData();
    fd.append("file", file);
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
      if (extracted > 0) {
        setTab("bidders");
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
    const trimmed = bname.trim();
    if (trimmed.length < 2) {
      setNameError(t("workspace.nameErrorMin"));
      return;
    }
    setNameError(null);
    setBusy(true);
    setMsg(null);
    setMsgType("info");
    try {
      await apiFetch(`/tenders/${tenderId}/bidders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed }),
      });
      const previousName = trimmed;
      setBname(`Bidder ${bidders.length + 2}`);
      toast.success(t("workspace.bidderRegistered", { name: previousName }));
      await refresh();
      bidderNameInputRef.current?.focus();
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
    setUploadingEvidence({ bidderId, docType });
    setBusy(true);
    setMsg(null);
    setMsgType("info");
    const fd = new FormData();
    fd.append("file", file);
    fd.append("doc_type", docType);
    try {
      await apiUpload(`/bidders/${bidderId}/documents`, fd);
      await refresh();
      setMobileSheet(null);
      setMsg(t("workspace.bidderOcrComplete"));
      toast.success(t("workspace.bidderOcrComplete"));
    } catch (ex: unknown) {
      const message = ex instanceof Error ? ex.message : String(ex);
      setMsgType("error");
      setMsg(message);
      toast.error(t("workspace.evidenceUploadFailed", { message }));
    } finally {
      setBusy(false);
      setUploadingEvidence(null);
    }
  }

  async function loadDemoBidders() {
    setBusy(true);
    try {
      const r1 = (await apiFetch(`/tenders/${tenderId}/bidders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Demo Bidder Acme (eligible)" }),
      })) as { id: string };
      const r2 = (await apiFetch(`/tenders/${tenderId}/bidders`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Demo Bidder Beta (conflict case)" }),
      })) as { id: string };
      const f1 = await fetch(DEMO_ACME_PDF_URL);
      const f2 = await fetch(DEMO_BETA_PDF_URL);
      const b1 = await f1.blob();
      const b2 = await f2.blob();
      await apiUpload(`/bidders/${r1.id}/documents`, (() => {
        const fd = new FormData();
        fd.append("file", new File([b1], "acme_demo.pdf", { type: "application/pdf" }));
        fd.append("doc_type", "gst_certificate");
        return fd;
      })());
      await apiUpload(`/bidders/${r2.id}/documents`, (() => {
        const fd = new FormData();
        fd.append("file", new File([b2], "beta_demo.pdf", { type: "application/pdf" }));
        fd.append("doc_type", "itr");
        return fd;
      })());
      await refresh();
      toast.success(t("workspace.demoLoaded"));
      setTab("run");
    } catch (ex: unknown) {
      const message = ex instanceof Error ? ex.message : String(ex);
      toast.error(t("workspace.demoFailed", { message }));
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

  async function doRunEval() {
    const startedAt = Date.now();
    setBusy(true);
    setMsg(null);
    setMsgType("info");
    setEvalElapsed(0);
    setEvalRunning(true);
    setEvalJobProgress(0);
    evalPollAbortRef.current = false;
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
        if (evalPollAbortRef.current) {
          setMsgType("warning");
          setMsg(t("workspace.evalPollStopped"));
          setEvalRunning(false);
          setEvalJobId(null);
          setBusy(false);
          return;
        }
        attempts += 1;
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        const st = (await apiFetch(`/tenders/${tenderId}/evaluate/jobs/${queued.job_id}`)) as {
          status: string;
          error?: string;
          progress?: number;
        };
        if (typeof st.progress === "number") {
          setEvalJobProgress(st.progress);
        }
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
      setEvalJobProgress(null);
      setBusy(false);
    }
  }

  function runEval() {
    if (results?.decisions?.length) {
      toast.warning(t("workspace.reEvalWarning"), {
        durationMs: 12000,
        action: {
          label: t("workspace.reEvalProceed"),
          onClick: () => {
            void doRunEval();
          },
        },
      });
      return;
    }
    void doRunEval();
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

  const needsReviewCount = useMemo(
    () => (results?.decisions || []).filter((d) => String(d.verdict) === "NEEDS_REVIEW").length,
    [results],
  );

  const hasAnyBidderDoc = useMemo(
    () => Object.values(bidderDocuments).some((rows) => rows.length > 0),
    [bidderDocuments],
  );

  const eligibleBidderCount = useMemo(() => {
    if (!results?.decisions?.length) return 0;
    const scoreMap = new Map<
      string,
      { eligible: number; notEligible: number; needsReview: number; conflicts: number; total: number }
    >();
    for (const b of bidders) {
      scoreMap.set(b.id, { eligible: 0, notEligible: 0, needsReview: 0, conflicts: 0, total: 0 });
    }
    for (const d of results.decisions) {
      const bid = String((d as Decision).bidder_id || "");
      const entry = scoreMap.get(bid);
      if (!entry) continue;
      entry.total++;
      const v = String(d.verdict || "");
      if (v === "ELIGIBLE") entry.eligible++;
      else if (v === "NOT_ELIGIBLE") entry.notEligible++;
      else entry.needsReview++;
      if (String((d as Decision).reason) === "CONFLICT_DETECTED") entry.conflicts++;
    }
    let n = 0;
    for (const [, s] of scoreMap) {
      if (s.total === 0) continue;
      if (s.conflicts > 0 || s.needsReview > 0) continue;
      if (s.notEligible > 0) continue;
      n++;
    }
    return n;
  }, [results, bidders]);

  const statusChip = useMemo(() => {
    if (evalRunning) {
      return { className: "status-chip status-chip--run", label: t("workspace.chipEvaluating") };
    }
    if (results?.decisions?.length) {
      if (needsReviewCount > 0) {
        return {
          className: "status-chip status-chip--warn",
          label: t("workspace.chipNeedsReview", { count: needsReviewCount }),
        };
      }
      return {
        className: "status-chip status-chip--ok",
        label: t("workspace.chipEvaluated", { eligible: eligibleBidderCount, bidders: bidders.length }),
      };
    }
    if (criteriaList.length && bidders.length && hasAnyBidderDoc) {
      return { className: "status-chip status-chip--muted", label: t("workspace.chipReady") };
    }
    if (criteriaList.length) {
      return { className: "status-chip status-chip--muted", label: t("workspace.chipCriteria") };
    }
    return { className: "status-chip status-chip--muted", label: t("workspace.chipDraft") };
  }, [
    evalRunning,
    results,
    needsReviewCount,
    eligibleBidderCount,
    bidders.length,
    criteriaList.length,
    hasAnyBidderDoc,
    t,
  ]);

  const showOnboarding = !results?.decisions?.length;
  const onboardingActiveStep = useMemo(() => {
    if (criteriaList.length === 0) return 0;
    if (bidders.length === 0) return 1;
    if (!hasAnyBidderDoc) return 2;
    return 3;
  }, [criteriaList.length, bidders.length, hasAnyBidderDoc]);

  const onboardingSteps = useMemo(
    () => [
      {
        id: "tender",
        label: t("workspace.onboard.tender"),
        done: criteriaList.length > 0,
        tooltip: t("workspace.onboard.tenderTip"),
      },
      {
        id: "bidders",
        label: t("workspace.onboard.bidders"),
        done: bidders.length > 0,
        tooltip: t("workspace.onboard.biddersTip"),
      },
      {
        id: "docs",
        label: t("workspace.onboard.evidence"),
        done: hasAnyBidderDoc,
        tooltip: t("workspace.onboard.evidenceTip"),
      },
      {
        id: "evaluate",
        label: t("workspace.onboard.evaluate"),
        done: results?.decisions != null && results.decisions.length > 0,
        tooltip: t("workspace.onboard.evaluateTip"),
      },
    ],
    [t, criteriaList.length, bidders.length, hasAnyBidderDoc, results],
  );

  const evidenceTypes = useMemo(
    () => [
      { key: "ca_certificate", label: t("workspace.docCa") },
      { key: "gst_certificate", label: t("workspace.docGst") },
      { key: "audited_balance_sheet", label: t("workspace.docBalance") },
      { key: "itr", label: t("workspace.docItr") },
      { key: "iso_certificate", label: t("workspace.docIso") },
      { key: "work_order", label: t("workspace.docWorkOrder") },
      { key: "experience_letters", label: t("workspace.docExperience") },
      { key: "bank_statement", label: t("workspace.docBank") },
      { key: "technical_brochure", label: t("workspace.docTechBrochure") },
    ],
    [t],
  );

  const evalEstimateSec = Math.max(30, Math.round(criteriaList.length * bidders.length * 1.2));

  const tabLabels: Record<"docs" | "bidders" | "run" | "results", string> = useMemo(
    () => ({
      docs:
        criteriaList.length > 0
          ? t("workspace.tabDocsCriteria", { count: criteriaList.length })
          : t("workspace.tabDocsPending"),
      bidders: t("workspace.tabBiddersCount", { count: bidders.length }),
      run:
        results?.decisions?.length && !evalRunning
          ? t("workspace.tabRunDone")
          : evalRunning
            ? t("workspace.tabRunBusy")
            : t("workspace.tabRun"),
      results:
        needsReviewCount > 0
          ? t("workspace.tabResultsReview", { count: needsReviewCount })
          : t("workspace.tabResults"),
    }),
    [t, criteriaList.length, bidders.length, results, needsReviewCount, evalRunning],
  );

  const showBidderPagination = bidderTotal != null;
  const canBidderPrev = bidderOffset > 0;
  const canBidderNext = bidderTotal != null && bidderOffset + bidders.length < bidderTotal;

  return (
    <div className="shell">
      <AppHeader
        left={
          <>
            <Link to="/app" className="link-back">
              ← {t("common.back")}
            </Link>
            <strong className="page-title-inline">{String(tender?.title || t("workspace.fallbackTitle"))}</strong>
            <span className={statusChip.className} title={String(tender?.status || "")}>
              {statusChip.label}
            </span>
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

      {showOnboarding && (
        <OnboardingProgress steps={onboardingSteps} activeIndex={onboardingActiveStep} />
      )}

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

      {import.meta.env.DEV && (
        <div style={{ marginBottom: 12 }}>
          <button type="button" className="ghost" style={{ fontSize: "0.75rem" }} disabled={busy} onClick={() => void loadDemoBidders()}>
            {t("workspace.loadDemoBidders")}
          </button>
        </div>
      )}

      {pageLoading ? (
        <WorkspaceSkeleton />
      ) : (
        <>
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
                <button
                  className="ghost"
                  type="button"
                  aria-label={t("workspace.dismissNotification")}
                  onClick={() => setMsg(null)}
                >
                  {t("common.dismiss")}
                </button>
              </div>
            </div>
          )}

          {tab === "docs" && (
            <div className="panel">
              <h2>{t("workspace.uploadTitle")}</h2>
              <p className="muted">{t("workspace.uploadCopy")}</p>
              <FileDropZone busy={busy} maxMb={20} onFile={(file) => void uploadTenderFile(file)} disabled={busy} />
              <div style={{ height: 16 }} />
              <h3>{t("workspace.extractedCriteria", { count: criteriaList.length })}</h3>
              {criteriaList.map((raw, i) => {
                const c = raw as Record<string, unknown>;
                const id = String(c.id || "");
                return (
                  <CriterionRow
                    key={id || String(i)}
                    tenderId={tenderId}
                    raw={c}
                    onChanged={() => refresh({ silent: true })}
                  />
                );
              })}
              <AddCriterionForm tenderId={tenderId} onAdded={() => refresh()} />
            </div>
          )}

      {tab === "bidders" && (
        <div className="grid2">
          <div className="panel">
            <h2>{t("workspace.registerBidder")}</h2>
            <form onSubmit={addBidder}>
              <label htmlFor="bidder-name-input">{t("workspace.legalName")}</label>
              <input
                id="bidder-name-input"
                ref={bidderNameInputRef}
                value={bname}
                aria-invalid={nameError ? true : undefined}
                aria-describedby={nameError ? "bidder-name-error" : undefined}
                onChange={(e) => {
                  setBname(e.target.value);
                  if (nameError) setNameError(null);
                }}
              />
              {nameError && (
                <p id="bidder-name-error" className="auth-error" style={{ marginTop: 6, fontSize: "0.85rem" }}>
                  {nameError}
                </p>
              )}
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
                <div className="bidder-evidence-desktop">
                  <BidderDocChecklist
                    bidderId={b.id}
                    bidderName={b.name}
                    types={evidenceTypes}
                    documents={bidderDocuments[b.id] || []}
                    uploading={uploadingEvidence}
                    onPick={(docType, file) => void uploadBidderDoc(b.id, file, docType)}
                  />
                </div>
                <button
                  type="button"
                  className="ghost bidder-evidence-mobile-btn"
                  onClick={() => setMobileSheet({ id: b.id, name: b.name })}
                >
                  {t("workspace.mobileUploadEvidence")}
                </button>
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
                    aria-label={t("workspace.ariaPrevPage")}
                    disabled={!canBidderPrev}
                    onClick={() => setBidderOffset(Math.max(0, bidderOffset - bidderPageSize))}
                  >
                    {t("common.prev")}
                  </button>
                  <button
                    type="button"
                    className="ghost"
                    data-testid="bidders-next"
                    aria-label={t("workspace.ariaNextPage")}
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
            jobProgress={evalJobProgress}
          />
          <div className="panel">
            <h2>{t("workspace.evaluateAll")}</h2>
            <p className="muted">{t("workspace.evaluateCopy")}</p>
            <p className="muted" style={{ marginTop: 8 }}>
              {t("workspace.criteriaBidders", { criteria: criteriaList.length, bidders: bidders.length })}
            </p>
            <p className="muted" style={{ marginTop: 6, fontSize: "0.85rem" }}>
              {t("workspace.evalEta", { seconds: evalEstimateSec })}
            </p>
            <button data-testid="run-evaluate" className="primary" disabled={busy} onClick={runEval}>
              {evalRunning
                ? t("workspace.running")
                : busy
                  ? t("workspace.checkingPrereqs")
                  : t("workspace.runDecisionEngine")}
            </button>
            {evalRunning && (
              <div className="row" style={{ marginTop: 12, gap: 12, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    evalPollAbortRef.current = true;
                  }}
                >
                  {t("workspace.evalStopWaiting")}
                </button>
              </div>
            )}
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

      {tab === "results" && (
        <>
          {!results?.decisions?.length ? (
            <div className="panel" style={{ textAlign: "center", padding: "40px 24px" }}>
              <div style={{ fontSize: "2rem", marginBottom: 8 }} aria-hidden>
                ⚙️
              </div>
              <h2 style={{ margin: "0 0 8px" }}>{t("workspace.resultsEmptyTitle")}</h2>
              <p className="muted" style={{ maxWidth: 440, margin: "0 auto 16px" }}>
                {t("workspace.resultsEmptyBody")}
              </p>
              <button type="button" className="primary" onClick={() => setTab("run")}>
                {t("workspace.resultsEmptyCta")}
              </button>
            </div>
          ) : (
            <>
              <BidderScoreboard
                decisions={results.decisions}
                bidders={bidders}
                criterionLabelById={criterionLabelById}
              />
              <RiskScorePanel decisions={results.decisions} />
              <ContradictionAlert
                decisions={results.decisions}
                bidderNameMap={bidderNameMap}
                criterionLabelById={criterionLabelById}
              />
              <div className="grid2">
                <div className="panel">
                  <h2>{t("workspace.verdictDetailSection")}</h2>
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
                  <h3 style={{ marginTop: 8 }}>{t("workspace.criterionDetail")}</h3>
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
                  <ReasoningGraph graph={results.graph as { nodes: []; edges: [] } | null} />
                </div>
              </div>
            </>
          )}
        </>
      )}
        </>
      )}

      {mobileSheet && (
        <BidderDocMobileSheet
          open
          bidderName={mobileSheet.name}
          types={evidenceTypes}
          busy={!!uploadingEvidence}
          onClose={() => setMobileSheet(null)}
          onUpload={(docType, file) => void uploadBidderDoc(mobileSheet.id, file, docType)}
        />
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
    </div>
  );
}
