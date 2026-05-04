import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiFetch, apiFetchWithMeta } from "../api";
import AppHeader from "../components/shell/AppHeader";
import { useToast } from "../components/shell/ToastProvider";
import { useDocumentTitle } from "../hooks/useDocumentTitle";

type TenderRow = { id: string; title: string; status: string; created_at: string };

const PAGE_SIZES = [25, 50, 100] as const;

export default function Dashboard() {
  useDocumentTitle("dashboard.documentTitle");
  const { t } = useTranslation();
  const toast = useToast();
  const [title, setTitle] = useState("Construction services — eligibility screening");
  const [description, setDescription] = useState("Hackathon demo tender");
  const [rows, setRows] = useState<TenderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageSize, setPageSize] = useState<number>(50);
  const [offset, setOffset] = useState(0);
  const [totalCount, setTotalCount] = useState<number | null>(null);

  async function load(nextOffset = offset, nextPageSize = pageSize) {
    setLoading(true);
    try {
      const { data, totalCount: count } = await apiFetchWithMeta<{ tenders: TenderRow[] }>(
        `/tenders?limit=${nextPageSize}&offset=${nextOffset}`,
      );
      setRows(data?.tenders || []);
      setTotalCount(count);
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : String(e);
      toast.error(t("dashboard.loadFailed", { message }));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load(offset, pageSize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [offset, pageSize]);

  async function create(e: FormEvent) {
    e.preventDefault();
    try {
      await apiFetch("/tenders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description }),
      });
      toast.success(t("dashboard.tenderCreated"));
      setTitle("");
      setDescription("");
      if (offset !== 0) setOffset(0);
      else await load(0, pageSize);
    } catch (ex: unknown) {
      const message = ex instanceof Error ? ex.message : String(ex);
      toast.error(t("dashboard.createFailed", { message }));
    }
  }

  const showPagination = totalCount != null;
  const canPrev = offset > 0;
  const canNext = totalCount != null && offset + rows.length < totalCount;
  const totalLabel =
    totalCount != null
      ? t("dashboard.totalCount", { count: totalCount })
      : t("dashboard.loadedCount", { count: rows.length });

  const stats = [
    { value: "6.3 Cr", label: "MSMEs in India", sub: "Small businesses eligible for public tenders" },
    { value: "₹3L Cr+", label: "Annual public procurement", sub: "Government spending evaluated manually today" },
    { value: "Explainable", label: "Evaluation by design", sub: "Verdicts grounded in clauses, figures, and evidence" },
  ];

  const valueProps = [
    { icon: "◆", label: "Conflict detection", desc: "Flags contradictory figures across documents before a verdict is issued." },
    { icon: "◇", label: "Explainable verdicts", desc: "Every ELIGIBLE / NOT ELIGIBLE ties to a clause, a value, and a confidence score." },
    { icon: "◈", label: "Human-in-the-loop", desc: "Ambiguous cases never silently disqualify — they route to the officer queue." },
    { icon: "◎", label: "Bharat-first", desc: "Devanagari OCR · translation · workflows tuned for Indian procurement practice." },
  ];

  return (
    <div className="shell">
      <AppHeader
        left={
          <>
            <strong className="brand-wordmark">{t("common.appName")}</strong>
            <span className="brand-tagline">{t("dashboard.headerSubtitle")}</span>
          </>
        }
        actions={
          <Link to="/review" className="link-button link-button--ghost">
            {t("common.reviewQueueButton")}
          </Link>
        }
      />

      <div className="stat-grid">
        {stats.map(({ value, label, sub }) => (
          <div key={label} className="stat-card">
            <div className="stat-card__value">{value}</div>
            <div className="stat-card__label">{label}</div>
            <p className="stat-card__sub">{sub}</p>
          </div>
        ))}
      </div>

      <div className="grid2">
        <div className="panel">
          <h2>{t("dashboard.newTender")}</h2>
          <p className="muted" style={{ marginTop: 4 }}>
            {t("dashboard.pipelineCopy")}
          </p>
          <form style={{ marginTop: 18 }} onSubmit={create}>
            <label htmlFor="tender-field-title">{t("dashboard.title")}</label>
            <input
              id="tender-field-title"
              data-testid="tender-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
            <div style={{ height: 10 }} />
            <label htmlFor="tender-field-description">{t("dashboard.description")}</label>
            <textarea
              id="tender-field-description"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
            <div style={{ height: 14 }} />
            <button data-testid="tender-create" className="primary" type="submit">
              {t("dashboard.createTender")}
            </button>
          </form>
        </div>
        <div className="panel" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div>
            <h2 style={{ margin: "0 0 6px" }}>Why this matters</h2>
            <p className="muted" style={{ margin: 0, fontSize: "0.92rem", lineHeight: 1.65 }}>
              Indian MSMEs lose tenders they deserve — not because they are unqualified, but because a buried clause or
              inconsistent document slips past manual review. TenderSense makes reasoning visible and the process auditable.
            </p>
          </div>
          <div className="value-prop-list" style={{ marginTop: 8 }}>
            {valueProps.map(({ icon, label, desc }) => (
              <div key={label} className="value-prop">
                <div className="value-prop__icon" aria-hidden>
                  {icon}
                </div>
                <div>
                  <div className="value-prop__title">{label}</div>
                  <p className="value-prop__desc">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{ height: 8 }} />

      <div className="panel" style={{ marginTop: 22 }}>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 16, alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>{t("dashboard.activeTenders")}</h2>
          <span className="badge ok" data-testid="tenders-total">
            {totalLabel}
          </span>
        </div>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>{t("dashboard.tableTitle")}</th>
                <th>{t("dashboard.tableStatus")}</th>
                <th>{t("dashboard.tableAction")}</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={3} style={{ textAlign: "center", padding: 40 }} className="muted">
                    {t("dashboard.loadingTenders")}
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={3} style={{ textAlign: "center", padding: 40 }} className="muted" data-testid="tenders-empty">
                    {t("dashboard.empty")}
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const st = String(r.status || "").toLowerCase();
                  const chip =
                    st === "open"
                      ? { cls: "badge ok", label: t("dashboard.statusOpen") }
                      : st === "draft"
                        ? { cls: "badge", label: t("dashboard.statusDraft") }
                        : { cls: "badge review", label: r.status };
                  return (
                  <tr key={r.id}>
                    <td style={{ fontWeight: 600 }}>{r.title}</td>
                    <td>
                      <span className={chip.cls}>{chip.label}</span>
                    </td>
                    <td>
                      <Link to={`/tender/${r.id}`} className="link-button link-button--ghost link-button--compact">
                        {t("dashboard.openWorkspace")}
                      </Link>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {showPagination && (
          <div className="row" data-testid="tenders-pagination" style={{ marginTop: 16, justifyContent: "space-between" }}>
            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              <label htmlFor="tender-page-size" style={{ margin: 0 }}>
                {t("common.pageSize")}
              </label>
              <select
                id="tender-page-size"
                data-testid="tenders-page-size"
                value={pageSize}
                onChange={(e) => {
                  const next = Number(e.target.value);
                  setPageSize(next);
                  setOffset(0);
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
                  start: offset + 1,
                  end: offset + rows.length,
                  total: totalCount,
                })}
              </span>
              <button
                type="button"
                className="ghost"
                data-testid="tenders-prev"
                aria-label={t("workspace.ariaPrevPage")}
                disabled={!canPrev}
                onClick={() => setOffset(Math.max(0, offset - pageSize))}
              >
                {t("common.prev")}
              </button>
              <button
                type="button"
                className="ghost"
                data-testid="tenders-next"
                aria-label={t("workspace.ariaNextPage")}
                disabled={!canNext}
                onClick={() => setOffset(offset + pageSize)}
              >
                {t("common.next")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
