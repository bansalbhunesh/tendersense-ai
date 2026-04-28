type EvidenceSnap = {
  document?: string;
  evidence_quote?: string;
  extracted_value?: string;
  normalized_value?: number;
  ocr_confidence?: number;
};

type Ambiguity = {
  extraction?: number;
  semantic?: number;
  conflict?: number;
};

type DecisionTrace = {
  field?: string;
  operator?: string;
  target?: number;
  extracted?: number;
  source_doc?: string;
  evidence_count?: number;
  mode?: string;
};

export type Decision = Record<string, unknown> & {
  verdict?: string;
  reason?: string;
  reasoning?: string;
  confidence?: number;
  criterion_id?: string;
  bidder_id?: string;
  evidence_snapshot?: EvidenceSnap;
  ambiguity?: Ambiguity;
  decision_trace?: DecisionTrace;
};

// ── formatting helpers ──────────────────────────────────────────────────────

function formatINR(val: unknown): string {
  const n = Number(val);
  if (!n || isNaN(n)) return "—";
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(2)} Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)} L`;
  return `₹${n.toLocaleString("en-IN")}`;
}

function opLabel(op: string): string {
  return (
    { ">=": "at least", "<=": "at most", ">": "more than", "<": "less than", "==": "exactly" }[op] ?? op
  );
}

function ConfBar({
  value,
  color,
}: {
  value: number;
  color: string;
}) {
  const pct = Math.round(value * 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <div
        style={{
          flex: 1,
          height: 6,
          borderRadius: 3,
          background: "rgba(255,255,255,0.07)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: color,
            borderRadius: 3,
            transition: "width 0.6s cubic-bezier(0.4,0,0.2,1)",
          }}
        />
      </div>
      <span
        className="mono"
        style={{ fontSize: "0.72rem", color, minWidth: 32, textAlign: "right" }}
      >
        {pct}%
      </span>
    </div>
  );
}

// ── ELIGIBLE card ───────────────────────────────────────────────────────────

function EligibleCard({
  trace,
  snap,
  confidence,
  criterionLabel,
}: {
  trace: DecisionTrace;
  snap?: EvidenceSnap;
  confidence: number;
  criterionLabel: string;
}) {
  const reqLine =
    trace.target != null && trace.operator
      ? `${opLabel(trace.operator)} ${formatINR(trace.target)}`
      : null;
  const foundLine = snap?.normalized_value
    ? formatINR(snap.normalized_value)
    : trace.extracted
    ? formatINR(trace.extracted)
    : snap?.extracted_value || "—";
  const sourceDoc = trace.source_doc || snap?.document || "submitted document";

  return (
    <div
      style={{
        borderLeft: "3px solid #10b981",
        borderRadius: "0 10px 10px 0",
        padding: "14px 16px",
        background: "rgba(16,185,129,0.04)",
        marginBottom: 2,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontWeight: 700, fontSize: "0.88rem", color: "var(--text)" }}>
          {criterionLabel.length > 80 ? `${criterionLabel.slice(0, 77)}…` : criterionLabel}
        </span>
        <span
          className="badge ok"
          style={{ flexShrink: 0 }}
        >
          ✓ ELIGIBLE
        </span>
      </div>

      {reqLine && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              background: "rgba(0,0,0,0.15)",
              border: "1px solid rgba(148,163,184,0.15)",
            }}
          >
            <div style={{ fontSize: "0.65rem", color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Requirement
            </div>
            <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "#d1fae5" }}>{reqLine}</div>
          </div>
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              background: "rgba(16,185,129,0.06)",
              border: "1px solid rgba(16,185,129,0.25)",
            }}
          >
            <div style={{ fontSize: "0.65rem", color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Found
            </div>
            <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "#6ee7b7" }}>{foundLine}</div>
            <div style={{ fontSize: "0.68rem", color: "var(--muted)", marginTop: 2 }}>{sourceDoc}</div>
          </div>
        </div>
      )}

      <div>
        <div style={{ fontSize: "0.68rem", color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          AI Confidence
        </div>
        <ConfBar value={confidence} color="#10b981" />
      </div>

      <div
        style={{
          marginTop: 10,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 10px",
          borderRadius: 6,
          background: "rgba(16,185,129,0.08)",
          border: "1px solid rgba(16,185,129,0.2)",
          fontSize: "0.7rem",
          color: "#6ee7b7",
        }}
      >
        Auto-approved · no human review required
      </div>
    </div>
  );
}

// ── NOT_ELIGIBLE card ───────────────────────────────────────────────────────

function NotEligibleCard({
  trace,
  snap,
  confidence,
  criterionLabel,
  reasoning,
}: {
  trace: DecisionTrace;
  snap?: EvidenceSnap;
  confidence: number;
  criterionLabel: string;
  reasoning: string;
}) {
  const reqLine =
    trace.target != null && trace.operator
      ? `${opLabel(trace.operator)} ${formatINR(trace.target)}`
      : null;
  const foundVal = snap?.normalized_value ?? trace.extracted;
  const foundLine = foundVal ? formatINR(foundVal) : snap?.extracted_value || "—";
  const sourceDoc = trace.source_doc || snap?.document || "submitted document";

  let deficit: string | null = null;
  if (
    trace.target != null &&
    foundVal != null &&
    (trace.operator === ">=" || trace.operator === ">")
  ) {
    const diff = Number(trace.target) - Number(foundVal);
    if (diff > 0) deficit = `${formatINR(diff)} below threshold`;
  }

  return (
    <div
      style={{
        borderLeft: "3px solid #ef4444",
        borderRadius: "0 10px 10px 0",
        padding: "14px 16px",
        background: "rgba(239,68,68,0.04)",
        marginBottom: 2,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontWeight: 700, fontSize: "0.88rem", color: "var(--text)" }}>
          {criterionLabel.length > 80 ? `${criterionLabel.slice(0, 77)}…` : criterionLabel}
        </span>
        <span className="badge bad" style={{ flexShrink: 0 }}>
          ✗ NOT ELIGIBLE
        </span>
      </div>

      {reqLine && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 12 }}>
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              background: "rgba(0,0,0,0.15)",
              border: "1px solid rgba(148,163,184,0.15)",
            }}
          >
            <div style={{ fontSize: "0.65rem", color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Requirement (tender clause)
            </div>
            <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "#d1d5db" }}>{reqLine}</div>
          </div>
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              background: "rgba(239,68,68,0.06)",
              border: "1px solid rgba(239,68,68,0.3)",
            }}
          >
            <div style={{ fontSize: "0.65rem", color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>
              Found in submission
            </div>
            <div style={{ fontWeight: 700, fontSize: "0.9rem", color: "#fca5a5" }}>{foundLine}</div>
            <div style={{ fontSize: "0.68rem", color: "var(--muted)", marginTop: 2 }}>{sourceDoc}</div>
            {deficit && (
              <div
                style={{
                  marginTop: 6,
                  fontSize: "0.7rem",
                  color: "#ef4444",
                  fontWeight: 700,
                }}
              >
                ↓ {deficit}
              </div>
            )}
          </div>
        </div>
      )}

      {!reqLine && reasoning && (
        <p className="muted" style={{ fontSize: "0.85rem", marginBottom: 12 }}>
          {reasoning}
        </p>
      )}

      <div>
        <div style={{ fontSize: "0.68rem", color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          AI Confidence
        </div>
        <ConfBar value={confidence} color="#ef4444" />
      </div>

      <div
        style={{
          marginTop: 10,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 10px",
          borderRadius: 6,
          background: "rgba(239,68,68,0.08)",
          border: "1px solid rgba(239,68,68,0.2)",
          fontSize: "0.7rem",
          color: "#fca5a5",
        }}
      >
        Auto-rejected · requirement not met
      </div>
    </div>
  );
}

// ── CONFLICT_DETECTED card ──────────────────────────────────────────────────

function ConflictCard({
  trace,
  snap,
  confidence,
  criterionLabel,
}: {
  trace: DecisionTrace;
  snap?: EvidenceSnap;
  confidence: number;
  criterionLabel: string;
}) {
  const field = trace.field || "criterion";
  const count = trace.evidence_count || 2;

  return (
    <div
      style={{
        borderLeft: "3px solid #f59e0b",
        borderRadius: "0 10px 10px 0",
        padding: "14px 16px",
        background: "rgba(245,158,11,0.04)",
        marginBottom: 2,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
          marginBottom: 12,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontWeight: 700, fontSize: "0.88rem", color: "var(--text)" }}>
          {criterionLabel.length > 80 ? `${criterionLabel.slice(0, 77)}…` : criterionLabel}
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "4px 10px",
            borderRadius: 6,
            background: "rgba(245,158,11,0.12)",
            border: "1px solid rgba(245,158,11,0.4)",
            fontSize: "0.72rem",
            fontWeight: 800,
            color: "#fcd34d",
            flexShrink: 0,
          }}
        >
          ⚡ CONFLICT DETECTED
        </span>
      </div>

      {/* Document comparison */}
      <div
        style={{
          background: "rgba(0,0,0,0.15)",
          border: "1px solid rgba(245,158,11,0.25)",
          borderRadius: 10,
          padding: 14,
          marginBottom: 12,
        }}
      >
        <div
          style={{
            fontSize: "0.72rem",
            color: "var(--muted)",
            marginBottom: 10,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          Inconsistency detected across {count} submitted documents
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 10, alignItems: "center" }}>
          <div
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              background: "rgba(239,68,68,0.06)",
              border: "1px solid rgba(239,68,68,0.25)",
            }}
          >
            <div style={{ fontSize: "0.65rem", color: "var(--muted)", marginBottom: 4 }}>
              Source A · {snap?.document || "Document 1"}
            </div>
            <div className="mono" style={{ fontSize: "0.78rem", color: "#fca5a5" }}>
              {snap?.extracted_value || snap?.evidence_quote || `${field} value (Document A)`}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 3,
            }}
          >
            <div style={{ fontSize: "0.8rem", color: "#ef4444" }}>↔</div>
            <div
              style={{
                fontSize: "0.6rem",
                color: "#ef4444",
                fontWeight: 700,
                textAlign: "center",
                lineHeight: 1.3,
              }}
            >
              MISMATCH
            </div>
          </div>

          <div
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              background: "rgba(239,68,68,0.06)",
              border: "1px solid rgba(239,68,68,0.25)",
            }}
          >
            <div style={{ fontSize: "0.65rem", color: "var(--muted)", marginBottom: 4 }}>
              Source B · Document 2
            </div>
            <div className="mono" style={{ fontSize: "0.78rem", color: "#fca5a5" }}>
              {`${field} value differs from Source A`}
            </div>
          </div>
        </div>
      </div>

      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: "0.68rem", color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          AI Confidence (conflict suppressed to {Math.round(confidence * 100)}%)
        </div>
        <ConfBar value={confidence} color="#f59e0b" />
      </div>

      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 7,
          padding: "6px 12px",
          borderRadius: 8,
          background: "rgba(245,158,11,0.1)",
          border: "1px solid rgba(245,158,11,0.35)",
          fontSize: "0.72rem",
          color: "#fcd34d",
          fontWeight: 700,
        }}
      >
        → Escalated to Human Review Queue · officer signature required
      </div>
    </div>
  );
}

// ── NEEDS_REVIEW (generic — low confidence / no evidence) ──────────────────

function ReviewCard({
  confidence,
  criterionLabel,
  reasoning,
  reason,
}: {
  confidence: number;
  criterionLabel: string;
  reasoning: string;
  reason: string;
}) {
  const reasonLabel: Record<string, string> = {
    NO_EVIDENCE: "No evidence found in submitted documents",
    LOW_CONFIDENCE: "Evidence found but confidence below threshold",
    LOW_OCR_CONFIDENCE: "Document scan quality insufficient for reliable extraction",
    NO_BEST_EVIDENCE: "Could not select a primary evidence source",
  };

  return (
    <div
      style={{
        borderLeft: "3px solid #3b82f6",
        borderRadius: "0 10px 10px 0",
        padding: "14px 16px",
        background: "rgba(59,130,246,0.03)",
        marginBottom: 2,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
          marginBottom: 10,
          flexWrap: "wrap",
        }}
      >
        <span style={{ fontWeight: 700, fontSize: "0.88rem", color: "var(--text)" }}>
          {criterionLabel.length > 80 ? `${criterionLabel.slice(0, 77)}…` : criterionLabel}
        </span>
        <span className="badge review" style={{ flexShrink: 0 }}>
          NEEDS REVIEW
        </span>
      </div>

      <p
        style={{
          margin: "0 0 10px",
          fontSize: "0.82rem",
          color: "var(--muted)",
          padding: "8px 12px",
          background: "rgba(59,130,246,0.06)",
          borderRadius: 6,
          border: "1px solid rgba(59,130,246,0.15)",
        }}
      >
        {reasonLabel[reason] || reasoning || "Insufficient evidence for automated decision"}
      </p>

      <div>
        <div style={{ fontSize: "0.68rem", color: "var(--muted)", marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          AI Confidence
        </div>
        <ConfBar value={Math.max(confidence, 0.05)} color="#3b82f6" />
      </div>

      <div
        style={{
          marginTop: 10,
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "4px 10px",
          borderRadius: 6,
          background: "rgba(59,130,246,0.08)",
          border: "1px solid rgba(59,130,246,0.2)",
          fontSize: "0.7rem",
          color: "#93c5fd",
        }}
      >
        → Queued for officer review · will not auto-approve
      </div>
    </div>
  );
}

// ── public export ───────────────────────────────────────────────────────────

export default function DecisionCard({
  decision,
  criterionLabel,
}: {
  decision: Decision;
  criterionLabel: string;
}) {
  const verdict = String(decision.verdict || "NEEDS_REVIEW");
  const reason = String(decision.reason || "");
  const reasoning = String(decision.reasoning || "");
  const confidence = Number(decision.confidence ?? 0);
  const snap = decision.evidence_snapshot;
  const trace = (decision.decision_trace as DecisionTrace | undefined) ?? {};

  if (verdict === "ELIGIBLE") {
    return (
      <EligibleCard
        trace={trace}
        snap={snap}
        confidence={confidence}
        criterionLabel={criterionLabel}
      />
    );
  }

  if (verdict === "NOT_ELIGIBLE") {
    return (
      <NotEligibleCard
        trace={trace}
        snap={snap}
        confidence={confidence}
        criterionLabel={criterionLabel}
        reasoning={reasoning}
      />
    );
  }

  if (reason === "CONFLICT_DETECTED") {
    return (
      <ConflictCard
        trace={trace}
        snap={snap}
        confidence={confidence}
        criterionLabel={criterionLabel}
      />
    );
  }

  return (
    <ReviewCard
      confidence={confidence}
      criterionLabel={criterionLabel}
      reasoning={reasoning}
      reason={reason}
    />
  );
}
