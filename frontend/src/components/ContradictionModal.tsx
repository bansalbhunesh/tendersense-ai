import { useEffect, useState } from "react";

type ConflictData = {
  bidderName: string;
  criterionLabel: string;
  field: string;
  confidence: number;
  evidenceCount: number;
};

function AnimatedBar({ targetPct, color }: { targetPct: number; color: string }) {
  const [pct, setPct] = useState(100);

  useEffect(() => {
    const t = setTimeout(() => setPct(targetPct), 300);
    return () => clearTimeout(t);
  }, [targetPct]);

  return (
    <div>
      <div
        style={{
          height: 10,
          borderRadius: 5,
          background: "rgba(255,255,255,0.06)",
          overflow: "hidden",
          marginBottom: 6,
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: pct > 70 ? "#10b981" : pct > 50 ? color : "#ef4444",
            borderRadius: 5,
            transition: "width 1.2s cubic-bezier(0.4,0,0.2,1), background 0.8s ease",
          }}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: "0.72rem", color: "var(--muted)" }}>
          0%  {" "} threshold: 70%
        </span>
        <span
          style={{
            fontSize: "0.78rem",
            fontWeight: 800,
            color: pct <= 70 ? "#fca5a5" : "#6ee7b7",
            transition: "color 0.6s ease",
          }}
        >
          {pct}%
        </span>
      </div>
    </div>
  );
}

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
        background: "rgba(3,7,18,0.85)",
        backdropFilter: "blur(8px)",
        opacity: visible ? 1 : 0,
        transition: "opacity 0.3s ease",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 520,
          width: "100%",
          background: "#0d1117",
          border: "1px solid rgba(239,68,68,0.45)",
          borderRadius: 20,
          overflow: "hidden",
          transform: visible ? "translateY(0) scale(1)" : "translateY(24px) scale(0.97)",
          transition: "transform 0.35s cubic-bezier(0.34,1.56,0.64,1)",
          boxShadow: "0 0 60px rgba(239,68,68,0.18), 0 24px 48px rgba(0,0,0,0.6)",
        }}
      >
        {/* Header stripe */}
        <div
          style={{
            background: "linear-gradient(135deg, rgba(239,68,68,0.12), rgba(239,68,68,0.04))",
            borderBottom: "1px solid rgba(239,68,68,0.2)",
            padding: "20px 24px",
            display: "flex",
            alignItems: "center",
            gap: 14,
          }}
        >
          <div
            style={{
              width: 46,
              height: 46,
              borderRadius: 12,
              background: "rgba(239,68,68,0.12)",
              border: "1px solid rgba(239,68,68,0.35)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "1.4rem",
              flexShrink: 0,
            }}
          >
            ⚡
          </div>
          <div>
            <div
              style={{
                fontWeight: 900,
                fontSize: "1rem",
                color: "#fca5a5",
                letterSpacing: "0.04em",
                marginBottom: 2,
              }}
            >
              MANIPULATION SIGNAL DETECTED
            </div>
            <div style={{ fontSize: "0.75rem", color: "var(--muted)" }}>
              AI caught an inconsistency that prevents automatic approval
            </div>
          </div>
          {/* Pulsing indicator */}
          <div
            className="pulse-dot"
            style={{
              marginLeft: "auto",
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "#ef4444",
              flexShrink: 0,
            }}
          />
        </div>

        {/* Body */}
        <div style={{ padding: "24px" }}>
          {/* Who / What */}
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 10,
              marginBottom: 20,
            }}
          >
            <div
              style={{
                padding: "12px 14px",
                borderRadius: 10,
                background: "rgba(0,0,0,0.3)",
                border: "1px solid rgba(148,163,184,0.12)",
              }}
            >
              <div style={{ fontSize: "0.62rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5 }}>
                Bidder flagged
              </div>
              <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "var(--text)" }}>
                {data.bidderName}
              </div>
            </div>
            <div
              style={{
                padding: "12px 14px",
                borderRadius: 10,
                background: "rgba(239,68,68,0.06)",
                border: "1px solid rgba(239,68,68,0.2)",
              }}
            >
              <div style={{ fontSize: "0.62rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 5 }}>
                Criterion in conflict
              </div>
              <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "#fca5a5" }}>
                {fieldLabel}
              </div>
            </div>
          </div>

          {/* Conflict visual */}
          <div
            style={{
              padding: "16px",
              borderRadius: 12,
              background: "rgba(239,68,68,0.05)",
              border: "1px solid rgba(239,68,68,0.2)",
              marginBottom: 20,
              textAlign: "center",
            }}
          >
            <div style={{ fontSize: "0.7rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 14 }}>
              Cross-document inconsistency · {data.evidenceCount} sources compared
            </div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto 1fr",
                gap: 10,
                alignItems: "center",
              }}
            >
              <div
                style={{
                  padding: "12px",
                  borderRadius: 8,
                  background: "rgba(0,0,0,0.25)",
                  border: "1px solid rgba(239,68,68,0.2)",
                }}
              >
                <div style={{ fontSize: "0.62rem", color: "var(--muted)", marginBottom: 6 }}>Document A</div>
                <div className="mono" style={{ fontSize: "0.85rem", color: "#fca5a5" }}>Value A</div>
              </div>
              <div>
                <div style={{ fontSize: "1.4rem", color: "#ef4444", lineHeight: 1 }}>↔</div>
                <div style={{ fontSize: "0.58rem", color: "#ef4444", fontWeight: 800, marginTop: 2 }}>MISMATCH</div>
              </div>
              <div
                style={{
                  padding: "12px",
                  borderRadius: 8,
                  background: "rgba(0,0,0,0.25)",
                  border: "1px solid rgba(239,68,68,0.2)",
                }}
              >
                <div style={{ fontSize: "0.62rem", color: "var(--muted)", marginBottom: 6 }}>Document B</div>
                <div className="mono" style={{ fontSize: "0.85rem", color: "#fca5a5" }}>Value B</div>
              </div>
            </div>
            <div
              style={{
                marginTop: 12,
                fontSize: "0.75rem",
                color: "var(--muted)",
                fontStyle: "italic",
              }}
            >
              "{data.criterionLabel.slice(0, 90)}{data.criterionLabel.length > 90 ? "…" : ""}"
            </div>
          </div>

          {/* Confidence drop */}
          <div style={{ marginBottom: 20 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              <span style={{ fontSize: "0.72rem", color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                AI Confidence — dropped below 70% threshold
              </span>
            </div>
            <AnimatedBar
              targetPct={Math.round(data.confidence * 100)}
              color="#f59e0b"
            />
          </div>

          {/* Routing */}
          <div
            style={{
              padding: "12px 16px",
              borderRadius: 10,
              background: "rgba(245,158,11,0.06)",
              border: "1px solid rgba(245,158,11,0.25)",
              marginBottom: 20,
              display: "flex",
              alignItems: "center",
              gap: 10,
            }}
          >
            <span style={{ fontSize: "1rem" }}>👤</span>
            <span style={{ fontSize: "0.82rem", color: "#fcd34d" }}>
              <strong>Mandatory officer review required.</strong>{" "}
              This submission cannot be auto-approved or auto-rejected.
              The officer must record a signed justification.
            </span>
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: 10 }}>
            <button
              className="primary"
              style={{ flex: 1 }}
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
