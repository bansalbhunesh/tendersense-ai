import { FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiFetch } from "../../api";

export default function AddCriterionForm({
  tenderId,
  onAdded,
}: {
  tenderId: string;
  onAdded: () => void | Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [field, setField] = useState("");
  const [operator, setOperator] = useState(">=");
  const [valueStr, setValueStr] = useState("");
  const [unit, setUnit] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      let value: string | number = valueStr;
      const num = Number(valueStr);
      if (valueStr.trim() !== "" && !Number.isNaN(num) && String(num) === valueStr.trim()) {
        value = num;
      }
      await apiFetch(`/tenders/${tenderId}/criteria`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field, operator, value, unit }),
      });
      setField("");
      setValueStr("");
      setUnit("");
      setOpen(false);
      await Promise.resolve(onAdded());
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className="ghost" style={{ marginTop: 12 }} onClick={() => setOpen(true)}>
        + {t("workspace.addCriterionManually")}
      </button>
    );
  }

  return (
    <form className="nest-card" style={{ marginTop: 12 }} onSubmit={(e) => void submit(e)}>
      <strong style={{ fontSize: "0.88rem" }}>{t("workspace.addCriterionManually")}</strong>
      <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
        <label>
          {t("workspace.criterionField")}
          <input required value={field} onChange={(e) => setField(e.target.value)} style={{ width: "100%" }} />
        </label>
        <label>
          {t("workspace.criterionOperator")}
          <input required value={operator} onChange={(e) => setOperator(e.target.value)} style={{ width: "100%" }} />
        </label>
        <label>
          {t("workspace.criterionValue")}
          <input required value={valueStr} onChange={(e) => setValueStr(e.target.value)} style={{ width: "100%" }} />
        </label>
        <label>
          {t("workspace.criterionUnit")}
          <input value={unit} onChange={(e) => setUnit(e.target.value)} style={{ width: "100%" }} />
        </label>
      </div>
      <div className="row" style={{ gap: 8, marginTop: 12 }}>
        <button className="primary" type="submit" disabled={busy}>
          {t("workspace.criterionAddSubmit")}
        </button>
        <button type="button" className="ghost" disabled={busy} onClick={() => setOpen(false)}>
          {t("common.close")}
        </button>
      </div>
    </form>
  );
}
