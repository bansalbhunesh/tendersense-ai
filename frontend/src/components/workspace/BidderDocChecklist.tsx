import { useId, useMemo, useState } from "react";

export type BidderDocRow = {
  id: string;
  filename: string;
  doc_type: string;
  created_at?: string;
  quality_score?: number;
};

function latestByType(docs: BidderDocRow[]): Map<string, BidderDocRow> {
  const m = new Map<string, BidderDocRow>();
  for (const d of docs) {
    const key = d.doc_type || "supporting";
    const prev = m.get(key);
    if (!prev) {
      m.set(key, d);
      continue;
    }
    const t1 = Date.parse(String(d.created_at || "")) || 0;
    const t0 = Date.parse(String(prev.created_at || "")) || 0;
    if (t1 >= t0) m.set(key, d);
  }
  return m;
}

export default function BidderDocChecklist({
  bidderId,
  bidderName,
  types,
  documents,
  uploading,
  onPick,
}: {
  bidderId: string;
  bidderName: string;
  types: { key: string; label: string }[];
  documents: BidderDocRow[];
  uploading: { bidderId: string; docType: string } | null;
  onPick: (docType: string, file: File) => void;
}) {
  const byType = useMemo(() => latestByType(documents), [documents]);

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>{bidderName}</div>
      <div className="bidder-doc-checklist">
        {types.map(({ key, label }) => {
          const row = byType.get(key);
          const busy = uploading?.bidderId === bidderId && uploading?.docType === key;
          const done = !!row && !busy;
          return (
            <div
              key={key}
              className="bidder-doc-row"
              title={
                row
                  ? `${row.filename}${row.created_at ? ` · ${String(row.created_at).slice(0, 19)}` : ""}`
                  : undefined
              }
            >
              <span
                aria-hidden
                className="bidder-doc-dot"
                data-state={busy ? "uploading" : done ? "done" : "empty"}
              />
              <span className="bidder-doc-label">{label}</span>
              <label className="bidder-doc-upload">
                <span className="sr-only">{label}</span>
                <input
                  type="file"
                  accept=".pdf,.png,.jpg,.jpeg"
                  disabled={!!uploading}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = "";
                    if (f) onPick(key, f);
                  }}
                />
                {busy ? "Uploading…" : row ? "Replace" : "Upload"}
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Compact mobile control: pick type then file */
export function BidderDocMobileSheet({
  open,
  bidderName,
  types,
  busy,
  onClose,
  onUpload,
}: {
  open: boolean;
  bidderName: string;
  types: { key: string; label: string }[];
  busy: boolean;
  onClose: () => void;
  onUpload: (docType: string, file: File) => void;
}) {
  const fid = useId();
  const [docType, setDocType] = useState(types[0]?.key || "gst_certificate");
  if (!open) return null;
  return (
    <div className="bidder-sheet-backdrop" role="presentation" onClick={onClose}>
      <div
        className="bidder-sheet panel"
        role="dialog"
        aria-modal="true"
        aria-label={`Upload evidence for ${bidderName}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <strong>{bidderName}</strong>
          <button type="button" className="ghost" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        <label htmlFor={`${fid}-mobile-doc-type`}>Document type</label>
        <select
          id={`${fid}-mobile-doc-type`}
          value={docType}
          disabled={busy}
          onChange={(e) => setDocType(e.target.value)}
          style={{ width: "100%", marginTop: 6 }}
        >
          {types.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
        <div style={{ height: 12 }} />
        <input
          id={`${fid}-file`}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg"
          disabled={busy}
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) onUpload(docType, f);
          }}
        />
        <button
          type="button"
          className="primary"
          disabled={busy}
          style={{ width: "100%" }}
          onClick={() => document.getElementById(`${fid}-file`)?.click()}
        >
          Choose file
        </button>
      </div>
    </div>
  );
}
