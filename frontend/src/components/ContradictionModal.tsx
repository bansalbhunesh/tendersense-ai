import { useEffect, useState } from "react";

export type ConflictSnapshot = {
  document: string;
  doc_type?: string;
  normalized_value: number;
  raw_text?: string;
};

export type ConflictData = {
  bidderName: string;
  criterionLabel: string;
  field: string;
  confidence: number;
  evidenceCount: number;
  operator?: string;
  threshold?: number;
  conflictSnapshots?: ConflictSnapshot[];
};

// ── formatting ──────────────────────────────────────────────────────────────

function fmtINR(val: number): string {
  if (!val || isNaN(val)) return "—";
  if (val >= 1e7) return `₹${(val / 1e7).toFixed(2)} Cr`;
  if (val >= 1e5) return `₹${(val / 1e5).toFixed(1)} L`;
  return `₹${val.toLocaleString("en-IN")}`;
}

function opLabel(op: string): string {
  return (
    { ">=": "at least", "<=": "at most", ">": "more than", "<": "less than" }[op] ?? op
  );
}

function discrepancyPct(a: number, b: number): number {
  const max = Math.max(a, b);
  if (!max) return 0;
  return Math.round((Math.abs(a - b) / max) * 100);
}

// ── animated confidence bar ─────────────────────────────────────────────────

function AnimatedBar({ targetPct }: { targetPct: number }) {
  const [pct, setPct] = useState(100);

  useEffect(() => {
    const t = setTimeout(() => setPct(targetPct), 400);
    return () => clearTimeout(t);
  }, [targetPct]);

  const color = pct > 70 ? "#10b981" : pct > 55 ? "#f59e0b" : "#ef4444";

  return (
    <div>
      <div
        style={{
          height: 10,
          borderRadius: 5,
          background: "rgba(255,255,255,0.06)",
          overflow: "hidden",
          marginBottom: 6,
          position: "relative",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: color,
            borderRadius: 5,
            transition: "width 1.4s cubic-bezier(0.4,0,0.2,1), background 0.6s ease",
          }}
        />
        {/* 70% threshold marker */}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: "70%",
            width: 2,
            height: "100%",
            background: "rgba(255,255,255,0.3)",
          }}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: "0.68rem", color: "var(--muted)" }}>
          70% threshold for auto-decision
        </span>
        <span
          style={{
            fontSize: "0.78rem",
            fontWeight: 800,
            color,
            transition: "color 0.6s ease",
          }}
        >
          {pct}%
        </span>
      </div>
    </div>
  );
}

// ── document diff section ────────────────────────────────────────────────────

function DocumentDiff({
  snapshots,
  field,
}: {
  snapshots: ConflictSnapshot[];
  field: string;
}) {
  const a = snapshots[0];
  const b = snapshots[1];

  if (!a) return null;

  const aVal = fmtINR(a.normalized_value);
  const bVal = b ? fmtINR(b.normalized_value) : "—";
  const pct = b ? discrepancyPct(a.normalized_value, b.normalized_value) : 0;

  const docLabel = (s: ConflictSnapshot) => {
    const name = s.document || s.doc_type || "Document";
    return name.length > 28 ? `${name.slice(0, 25)}…` : name;
  };

  return (
    <div
      style={{
        background: "rgba(0,0,0,0.2)",
        border: "1px solid rgba(239,68,68,0.25)",
        borderRadius: 12,
        padding: 16,
        marginBottom: 20,
      }}
    >
      <div
        style={{
          fontSize: "0.62rem",
          color: "var(--muted)",
          textTransform: "uppercase",
          letterSpacing: "0.07em",
          marginBottom: 14,
          textAlign: "center",
        }}
      >
        Hidden contradiction in {field.replace(/_/g, " ")} · {snapshots.length} sources compared
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto 1fr",
          gap: 10,
          alignItems: "center",
        }}
      >
        {/* Doc A */}
        <div
          style={{
            padding: "14px 12px",
            borderRadius: 10,
            background: "rgba(239,68,68,0.06)",
            border: "1px solid rgba(239,68,68,0.25)",
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontSize: "0.62rem",
              color: "var(--muted)",
              marginBottom: 8,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {docLabel(a)}
          </div>
          <div
            style={{
              fontWeight: 900,
              fontSize: "1.3rem",
              color: "#fca5a5",
              letterSpacing: "-0.02em",
            }}
          >
            {aVal}
          </div>
        </div>

        {/* Centre indicator */}
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: "1.6rem", color: "#ef4444", lineHeight: 1 }}>↔</div>
          {pct > 0 && (
            <div
              style={{
                marginTop: 4,
                fontSize: "0.6rem",
                color: "#ef4444",
                fontWeight: 800,
                lineHeight: 1.3,
              }}
            >
              {pct}%
              <br />
              GAP
            </div>
          )}
        </div>

        {/* Doc B */}
        <div
          style={{
            padding: "14px 12px",
            borderRadius: 10,
            background: "rgba(239,68,68,0.06)",
            border: "1px solid rgba(239,68,68,0.25)",
            textAlign: "center",
          }}
        >
          <div
            style={{
              fontSize: "0.62rem",
              color: "var(--muted)",
              marginBottom: 8,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {b ? docLabel(b) : "Document B"}
          </div>
          <div
            style={{
              fontWeight: 900,
              fontSize: "1.3rem",
              color: "#fca5a5",
              letterSpacing: "-0.02em",
            }}
          >
            {bVal}
          </div>
        </div>
      </div>

      {/* Clause impacted */}
      <div
        style={{
          marginTop: 12,
          padding: "8px 12px",
          borderRadius: 8,
          background: "rgba(245,158,11,0.06)",
          border: "1px solid rgba(245,158,11,0.2)",
          fontSize: "0.73rem",
          color: "#fcd34d",
          textAlign: "center",
        }}
      >
        📋 Values are irreconcilable — system cannot determine which figure is correct
      </div>
    </div>
  );
}

// ── main modal ───────────────────────────────────────────────────────────────

export default function ContradictionModal({
  data,
  onViewAnalysis,
  onDismiss,
}: {
  data: ConflictData;
  onViewAnalysis: () => void;
  onDismiss: () => void;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 40);
    return () => clearTimeout(t);
  }, []);

  const fieldLabel = data.field
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

  const thresholdLine =
    data.threshold && data.operator
      ? `${opLabel(data.operator)} ${fmtINR(data.threshold)}`
      : null;

  const hasRealValues =
    Array.isArray(data.conflictSnapshots) && data.conflictSnapshots.length >= 2;

  return (
    <div
      onClick={onDismiss}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "rgba(3,7,18,0.88)",
        backdropFilter: "blur(10px)",
        opacity: visible ? 1 : 0,
        transition: "opacity 0.3s ease",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 540,
          width: "100%",
          background: "#0d1117",
          border: "1px solid rgba(239,68,68,0.5)",
          borderRadius: 20,
          overflow: "hidden",
          transform: visible
            ? "translateY(0) scale(1)"
            : "translateY(28px) scale(0.96)",
          transition: "transform 0.4s cubic-bezier(0.34,1.56,0.64,1)",
          boxShadow:
            "0 0 80px rgba(239,68,68,0.15), 0 32px 64px rgba(0,0,0,0.7)",
        }}
      >
        {/* Header */}
        <div
          style={{
            background:
              "linear-gradient(135deg, rgba(239,68,68,0.14), rgba(239,68,68,0.04))",
            borderBottom: "1px solid rgba(239,68,68,0.2)",
            padding: "20px 24px",
            display: "flex",
            alignItems: "center",
            gap: 14,
          }}
        >
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 12,
              background: "rgba(239,68,68,0.12)",
              border: "1px solid rgba(239,68,68,0.35)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "1.5rem",
              flexShrink: 0,
            }}
          >
            ⚡
          </div>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontWeight: 900,
                fontSize: "1rem",
                color: "#fca5a5",
                letterSpacing: "0.04em",
                marginBottom: 3,
              }}
            >
              HIDDEN CONTRADICTION DETECTED
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
              Financial documents submitted by{" "}
              <strong style={{ color: "var(--text)" }}>{data.bidderName}</strong>{" "}
              contain irreconcilable figures
            </div>
          </div>
          <div
            className="pulse-dot"
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "#ef4444",
              flexShrink: 0,
            }}
          />
        </div>

        {/* Body */}
        <div style={{ padding: "22px 24px" }}>
          {/* Criterion context */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: thresholdLine ? "1fr 1fr" : "1fr",
              gap: 10,
              marginBottom: 20,
            }}
          >
            <div
              style={{
                padding: "11px 14px",
                borderRadius: 10,
                background: "rgba(0,0,0,0.3)",
                border: "1px solid rgba(148,163,184,0.12)",
              }}
            >
              <div
                style={{
                  fontSize: "0.6rem",
                  color: "var(--muted)",
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                  marginBottom: 5,
                }}
              >
                Criterion in conflict
              </div>
              <div style={{ fontWeight: 700, fontSize: "0.88rem", color: "#fca5a5" }}>
                {fieldLabel}
              </div>
              {data.criterionLabel && data.criterionLabel !== data.field && (
                <div
                  className="muted"
                  style={{ fontSize: "0.68rem", marginTop: 3, lineHeight: 1.4 }}
                >
                  {data.criterionLabel.slice(0, 60)}
                  {data.criterionLabel.length > 60 ? "…" : ""}
                </div>
              )}
            </div>

            {thresholdLine && (
              <div
                style={{
                  padding: "11px 14px",
                  borderRadius: 10,
                  background: "rgba(245,158,11,0.06)",
                  border: "1px solid rgba(245,158,11,0.2)",
                }}
              >
                <div
                  style={{
                    fontSize: "0.6rem",
                    color: "var(--muted)",
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                    marginBottom: 5,
                  }}
                >
                  Tender requires
                </div>
                <div
                  style={{ fontWeight: 700, fontSize: "0.88rem", color: "#fcd34d" }}
                >
                  {thresholdLine}
                </div>
              </div>
            )}
          </div>

          {/* Real values or fallback */}
          {hasRealValues ? (
            <DocumentDiff
              snapshots={data.conflictSnapshots!}
              field={data.field}
            />
          ) : (
            <div
              style={{
                padding: "16px",
                borderRadius: 12,
                background: "rgba(239,68,68,0.05)",
                border: "1px solid rgba(239,68,68,0.2)",
                marginBottom: 20,
                textAlign: "center",
                color: "var(--muted)",
                fontSize: "0.82rem",
              }}
            >
              Contradictory values detected across{" "}
              {data.evidenceCount} submitted documents — figures cannot be reconciled
            </div>
          )}

          {/* Confidence drop */}
          <div style={{ marginBottom: 20 }}>
            <div
              style={{
                fontSize: "0.65rem",
                color: "var(--muted)",
                textTransform: "uppercase",
                letterSpacing: "0.07em",
                marginBottom: 8,
              }}
            >
              AI confidence — dropped below 70% auto-decision threshold
            </div>
            <AnimatedBar targetPct={Math.round(data.confidence * 100)} />
          </div>

          {/* Routing notice */}
          <div
            style={{
              padding: "12px 16px",
              borderRadius: 10,
              background: "rgba(245,158,11,0.06)",
              border: "1px solid rgba(245,158,11,0.25)",
              marginBottom: 20,
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
            }}
          >
            <span style={{ fontSize: "1rem", marginTop: 1, flexShrink: 0 }}>👤</span>
            <span style={{ fontSize: "0.8rem", color: "#fcd34d", lineHeight: 1.5 }}>
              <strong>Mandatory officer review required.</strong> This submission has been
              escalated to the human review queue. An officer must verify the original
              documents and record a signed justification before any verdict is issued.
            </span>
          </div>

          {/* CTA */}
          <div style={{ display: "flex", gap: 10 }}>
            <button
              className="primary"
              style={{ flex: 1, fontSize: "0.88rem" }}
              onClick={onViewAnalysis}
            >
              View Full Analysis →
            </button>
            <button className="ghost" onClick={onDismiss} style={{ flexShrink: 0 }}>
              Dismiss
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
