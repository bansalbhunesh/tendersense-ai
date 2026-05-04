import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiFetch } from "../../api";

function confidenceBand(v: unknown): "high" | "medium" | "low" {
  const n = Number(v);
  if (n >= 0.75) return "high";
  if (n >= 0.45) return "medium";
  return "low";
}

export default function CriterionRow({
  tenderId,
  raw,
  onChanged,
}: {
  tenderId: string;
  raw: Record<string, unknown>;
  onChanged: () => void | Promise<unknown>;
}) {
  const { t } = useTranslation();
  const id = String(raw.id || "");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [field, setField] = useState(String(raw.field || ""));
  const [operator, setOperator] = useState(String(raw.operator || ""));
  const [valueStr, setValueStr] = useState(String(raw.value ?? ""));
  const [unit, setUnit] = useState(String(raw.unit || ""));

  const band = useMemo(() => confidenceBand(raw.extraction_confidence), [raw.extraction_confidence]);

  async function save() {
    if (!id) return;
    setBusy(true);
    try {
      let value: string | number = valueStr;
      const num = Number(valueStr);
      if (valueStr.trim() !== "" && !Number.isNaN(num) && String(num) === valueStr.trim()) {
        value = num;
      }
      await apiFetch(`/tenders/${tenderId}/criteria/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field, operator, value, unit }),
      });
      setEditing(false);
      await Promise.resolve(onChanged());
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!id) return;
    if (!window.confirm(t("workspace.criterionDeleteConfirm"))) return;
    setBusy(true);
    try {
      await apiFetch(`/tenders/${tenderId}/criteria/${id}`, { method: "DELETE" });
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  const rawText = String(raw.text_raw || "").slice(0, 280);

  return (
    <div className="nest-card">
      <div className="row" style={{ justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          {editing ? (
            <div style={{ display: "grid", gap: 8 }}>
              <label className="muted" style={{ fontSize: "0.72rem" }}>
                {t("workspace.criterionField")}
                <input value={field} onChange={(e) => setField(e.target.value)} style={{ width: "100%", marginTop: 4 }} />
              </label>
              <label className="muted" style={{ fontSize: "0.72rem" }}>
                {t("workspace.criterionOperator")}
                <input value={operator} onChange={(e) => setOperator(e.target.value)} style={{ width: "100%", marginTop: 4 }} />
              </label>
              <label className="muted" style={{ fontSize: "0.72rem" }}>
                {t("workspace.criterionValue")}
                <input value={valueStr} onChange={(e) => setValueStr(e.target.value)} style={{ width: "100%", marginTop: 4 }} />
              </label>
              <label className="muted" style={{ fontSize: "0.72rem" }}>
                {t("workspace.criterionUnit")}
                <input value={unit} onChange={(e) => setUnit(e.target.value)} style={{ width: "100%", marginTop: 4 }} />
              </label>
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="primary" disabled={busy} onClick={() => void save()}>
                  {t("workspace.criterionSave")}
                </button>
                <button type="button" className="ghost" disabled={busy} onClick={() => setEditing(false)}>
                  {t("common.close")}
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="row" style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                <strong>{String(raw.field || "—")}</strong>
                <span className={`badge ${band === "high" ? "ok" : band === "medium" ? "review" : "bad"}`} style={{ fontSize: "0.65rem" }}>
                  {t(`workspace.criterionBand.${band}`)}
                </span>
              </div>
              <p className="muted" style={{ marginTop: 6, marginBottom: 4 }}>
                {String(raw.operator || "")}{" "}
                <span className="mono">{raw.value != null ? String(raw.value) : "—"}</span>
                {String(raw.unit || "") ? ` ${String(raw.unit)}` : ""}
              </p>
            </>
          )}
        </div>
        {!editing && (
          <div className="row" style={{ gap: 6, flexShrink: 0 }}>
            <button type="button" className="ghost" aria-label={t("workspace.criterionEditAria")} disabled={busy} onClick={() => setEditing(true)}>
              ✎
            </button>
            <button type="button" className="ghost" aria-label={t("workspace.criterionDeleteAria")} disabled={busy} onClick={() => void remove()}>
              ×
            </button>
          </div>
        )}
      </div>
      {rawText && !editing && (
        <p className="mono" style={{ fontSize: "0.85rem", opacity: 0.9 }}>
          {rawText}
          {String(raw.text_raw || "").length > 280 ? "…" : ""}
        </p>
      )}
    </div>
  );
}
