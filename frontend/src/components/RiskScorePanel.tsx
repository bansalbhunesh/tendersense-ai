type Decision = Record<string, unknown> & {
  verdict?: string;
  reasoning?: string;
  reason?: string;
  confidence?: number;
  bidder_id?: string;
};

const CONFLICT_RE = /conflict|contradict|mismatch|inconsist|manipul|discrepan/i;

function RingGauge({
  pct,
  color,
  label,
  sublabel,
}: {
  pct: number;
  color: string;
  label: string;
  sublabel: string;
}) {
  const r = 36;
  const circ = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(1, pct));
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <svg width="88" height="88" viewBox="0 0 88 88">
        <circle
          cx="44" cy="44" r={r}
          fill="none"
          stroke="var(--progress-track)"
          strokeWidth="8"
        />
        <circle
          cx="44" cy="44" r={r}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={`${clamped * circ} ${circ}`}
          transform="rotate(-90 44 44)"
          style={{ transition: "stroke-dasharray 0.9s cubic-bezier(0.4,0,0.2,1)" }}
        />
        <text x="44" y="49" textAnchor="middle" fill={color} fontSize="14" fontWeight="700" fontFamily="inherit">
          {Math.round(clamped * 100)}%
        </text>
      </svg>
      <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--text)", textAlign: "center", maxWidth: 90 }}>
        {label}
      </span>
      <span style={{ fontSize: "0.65rem", color: "var(--muted)", textAlign: "center", maxWidth: 90, lineHeight: 1.4 }}>
        {sublabel}
      </span>
    </div>
  );
}

export default function RiskScorePanel({ decisions }: { decisions: Decision[] }) {
  if (!decisions.length) return null;

  const total = decisions.length;
  const eligible = decisions.filter((d) => d.verdict === "ELIGIBLE").length;
  const needsReview = decisions.filter((d) => d.verdict === "NEEDS_REVIEW").length;
  const notEligible = decisions.filter((d) => d.verdict === "NOT_ELIGIBLE").length;
  const conflictsFound = decisions.filter((d) =>
    CONFLICT_RE.test(String(d.reasoning || d.reason || ""))
  ).length;

  const avgConf =
    decisions.reduce((s, d) => s + Number(d.confidence || 0), 0) / total;

  const trustScore = (eligible / total) * 0.6 + avgConf * 0.4;
  const fraudSignal = Math.min(conflictsFound / Math.max(total, 1), 1);
  const ambiguity = needsReview / total;
  const clarity = avgConf;

  const uniqueBidders = new Set(decisions.map((d) => d.bidder_id).filter(Boolean)).size;

  const overallRisk =
    conflictsFound > 0 ? "HIGH" : needsReview / total > 0.3 ? "MEDIUM" : "LOW";
  const riskColor =
    overallRisk === "HIGH" ? "#ef4444" : overallRisk === "MEDIUM" ? "#f59e0b" : "#0891b2";

  return (
    <div
      className="panel"
      style={{
        marginBottom: 20,
        borderColor:
          conflictsFound > 0
            ? "rgba(239,68,68,0.4)"
            : "var(--border)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 20,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>Tender Trust Intelligence</h2>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: "0.85rem" }}>
            {total} criterion evaluations · {uniqueBidders || "—"} bidder{uniqueBidders !== 1 ? "s" : ""}
            {" · "}AI-computed risk signals
          </p>
        </div>
        <span
          style={{
            display: "inline-block",
            padding: "6px 18px",
            borderRadius: 8,
            background: `${riskColor}18`,
            border: `1px solid ${riskColor}44`,
            color: riskColor,
            fontWeight: 800,
            fontSize: "0.8rem",
            letterSpacing: "0.08em",
          }}
        >
          {overallRisk} RISK
        </span>
      </div>

      <div
        style={{
          display: "flex",
          gap: 16,
          justifyContent: "space-around",
          flexWrap: "wrap",
          marginBottom: 20,
        }}
      >
        <RingGauge
          pct={trustScore}
          color="#0891b2"
          label="Trust Score"
          sublabel="Verdict + evidence confidence"
        />
        <RingGauge
          pct={fraudSignal}
          color="#ef4444"
          label="Fraud Signals"
          sublabel="Contradiction / manipulation flags"
        />
        <RingGauge
          pct={ambiguity}
          color="#f59e0b"
          label="Ambiguity"
          sublabel="Evidence missing or conflicting"
        />
        <RingGauge
          pct={clarity}
          color="#3b82f6"
          label="Evidence Clarity"
          sublabel="Avg OCR + extraction confidence"
        />
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 12px",
            borderRadius: 6,
            background: "rgba(8, 145, 178, 0.1)",
            border: "1px solid rgba(8, 145, 178, 0.22)",
            fontSize: "0.8rem",
            color: "#0e7490",
            fontWeight: 700,
          }}
        >
          ✓ {eligible} ELIGIBLE
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 12px",
            borderRadius: 6,
            background: "rgba(239,68,68,0.1)",
            border: "1px solid rgba(239,68,68,0.2)",
            fontSize: "0.8rem",
            color: "#ef4444",
            fontWeight: 700,
          }}
        >
          ✗ {notEligible} NOT ELIGIBLE
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 12px",
            borderRadius: 6,
            background: "rgba(245,158,11,0.1)",
            border: "1px solid rgba(245,158,11,0.2)",
            fontSize: "0.8rem",
            color: "#f59e0b",
            fontWeight: 700,
          }}
        >
          ⚠ {needsReview} NEEDS REVIEW
        </span>
        {conflictsFound > 0 && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 12px",
              borderRadius: 6,
              background: "rgba(239,68,68,0.15)",
              border: "1px solid rgba(239,68,68,0.4)",
              fontSize: "0.8rem",
              color: "#fca5a5",
              fontWeight: 700,
            }}
          >
            ⚡ {conflictsFound} CONFLICT{conflictsFound > 1 ? "S" : ""} DETECTED
          </span>
        )}
      </div>
    </div>
  );
}
