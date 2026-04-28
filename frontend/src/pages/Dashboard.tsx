import { FormEvent, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { apiFetch, apiFetchWithMeta } from "../api";
import AppHeader from "../components/AppHeader";
import { useToast } from "../components/ToastProvider";
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
      // Reset to first page so freshly created tender is visible.
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

  return (
    <div className="shell">
      <AppHeader
        left={
          <>
            <strong>{t("common.appName")}</strong>
            <span>{t("dashboard.headerSubtitle")}</span>
          </>
        }
        actions={
          <Link to="/review">
            <button className="ghost">{t("common.reviewQueueButton")}</button>
          </Link>
        }
      />

      <div className="grid2">
        <div className="panel">
          <h2>{t("dashboard.newTender")}</h2>
          <form onSubmit={create}>
            <label>{t("dashboard.title")}</label>
            <input data-testid="tender-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
            <div style={{ height: 10 }} />
            <label>{t("dashboard.description")}</label>
            <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
            <div style={{ height: 12 }} />
            <button data-testid="tender-create" className="primary" type="submit">
              {t("dashboard.createTender")}
            </button>
          </form>
        </div>
        <div className="panel">
          <h2>{t("dashboard.pipeline")}</h2>
          <p className="muted">{t("dashboard.pipelineCopy")}</p>
        </div>
      </div>

      <div style={{ height: 16 }} />

      <div className="panel" style={{ marginTop: 24 }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
          <h2>{t("dashboard.activeTenders")}</h2>
          <span className="badge ok" data-testid="tenders-total">{totalLabel}</span>
        </div>
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
              rows.map((r) => (
                <tr key={r.id}>
                  <td style={{ fontWeight: 600 }}>{r.title}</td>
                  <td>
                    <span className={`badge ${r.status === "open" ? "ok" : "review"}`}>{r.status}</span>
                  </td>
                  <td>
                    <Link to={`/tender/${r.id}`}>
                      <button className="ghost" style={{ padding: "6px 12px", fontSize: "0.85rem" }}>
                        {t("dashboard.openWorkspace")}
                      </button>
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        {showPagination && (
          <div
            className="row"
            data-testid="tenders-pagination"
            style={{ marginTop: 16, justifyContent: "space-between" }}
          >
            <div className="row" style={{ gap: 8, alignItems: "center" }}>
              <label htmlFor="tender-page-size" style={{ margin: 0 }}>{t("common.pageSize")}</label>
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
                  <option key={n} value={n}>{n}</option>
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
                disabled={!canPrev}
                onClick={() => setOffset(Math.max(0, offset - pageSize))}
              >
                {t("common.prev")}
              </button>
              <button
                type="button"
                className="ghost"
                data-testid="tenders-next"
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
