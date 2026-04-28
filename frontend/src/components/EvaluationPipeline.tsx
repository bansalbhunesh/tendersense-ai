const STAGES = [
  {
    id: "ocr",
    icon: "📄",
    label: "PDF Ingestion & OCR",
    desc: "Extract text from native PDFs, scanned documents, and Devanagari annexures",
    fromSec: 0,
  },
  {
    id: "extract",
    icon: "🔍",
    label: "Criteria Extraction",
    desc: "Parse eligibility conditions, numeric thresholds, and document requirements",
    fromSec: 5,
  },
  {
    id: "evidence",
    icon: "🗂",
    label: "Evidence Mapping",
    desc: "Cross-reference each bidder's documents against extracted criteria",
    fromSec: 11,
  },
  {
    id: "conflict",
    icon: "⚡",
    label: "Contradiction Detection",
    desc: "Flag value mismatches and inconsistencies across financial documents",
    fromSec: 18,
  },
  {
    id: "score",
    icon: "📊",
    label: "Confidence Scoring & Routing",
    desc: "Weight evidence quality — uncertain cases escalate to human review, never silent reject",
    fromSec: 26,
  },
] as const;

type Status = "done" | "active" | "pending";

function StageNode({
  icon,
  label,
  desc,
  status,
  isLast,
}: {
  icon: string;
  label: string;
  desc: string;
  status: Status;
  isLast: boolean;
}) {
  const colors: Record<Status, { dot: string; text: string; border: string; bg: string }> = {
    done: {
      dot: "#0891b2",
      text: "#155e75",
      border: "rgba(8, 145, 178, 0.42)",
      bg: "rgba(8, 145, 178, 0.09)",
    },
    active: {
      dot: "#f59e0b",
      text: "#9a3412",
      border: "rgba(245,158,11,0.55)",
      bg: "rgba(245,158,11,0.08)",
    },
    pending: {
      dot: "rgba(148,163,184,0.35)",
      text: "var(--muted)",
      border: "rgba(148,163,184,0.2)",
      bg: "transparent",
    },
  };
  const c = colors[status];

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", width: "100%" }}>
        {/* connector line left */}
        <div
          style={{
            flex: 1,
            height: 2,
            background: status === "pending" ? "rgba(148,163,184,0.15)" : c.dot,
            transition: "background 0.4s ease",
          }}
        />
        {/* dot */}
        <div
          style={{
            width: 44,
            height: 44,
            borderRadius: "50%",
            border: `2px solid ${c.border}`,
            background: c.bg,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "1.2rem",
            flexShrink: 0,
            position: "relative",
            transition: "border-color 0.4s ease, background 0.4s ease",
            boxShadow: status === "active" ? `0 0 0 4px rgba(245,158,11,0.18)` : "none",
          }}
          className={status === "active" ? "pipeline-pulse" : ""}
        >
          {status === "done" ? "✓" : icon}
        </div>
        {/* connector line right */}
        {!isLast ? (
          <div
            style={{
              flex: 1,
              height: 2,
              background:
                status === "done"
                  ? c.dot
                  : "rgba(148,163,184,0.15)",
              transition: "background 0.4s ease",
            }}
          />
        ) : (
          <div style={{ flex: 1 }} />
        )}
      </div>

      <div
        style={{
          marginTop: 10,
          textAlign: "center",
          padding: "0 4px",
        }}
      >
        <div
          style={{
            fontWeight: 700,
            fontSize: "0.78rem",
            color: status === "pending" ? "var(--muted)" : "var(--text)",
            marginBottom: 4,
            transition: "color 0.4s ease",
          }}
        >
          {label}
        </div>
        <div
          style={{
            fontSize: "0.68rem",
            color: c.text,
            lineHeight: 1.4,
            opacity: status === "pending" ? 0.5 : 1,
            transition: "opacity 0.4s ease",
          }}
        >
          {desc}
        </div>
      </div>
    </div>
  );
}

export default function EvaluationPipeline({
  running,
  elapsed,
  done,
  criteriaCount,
  bidderCount,
}: {
  running: boolean;
  elapsed: number;
  done: boolean;
  criteriaCount: number;
  bidderCount: number;
}) {
  const activeIdx = running
    ? STAGES.reduce((acc, s, i) => (elapsed >= s.fromSec ? i : acc), 0)
    : done
    ? STAGES.length
    : -1;

  const stageStatus = (i: number): Status => {
    if (!running && !done) return "pending";
    if (i < activeIdx) return "done";
    if (i === activeIdx && running) return "active";
    if (done) return "done";
    return "pending";
  };

  return (
    <div
      className="panel"
      style={{ marginBottom: 20 }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
          flexWrap: "wrap",
          gap: 8,
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>Evaluation Pipeline</h2>
          <p className="muted" style={{ margin: "3px 0 0", fontSize: "0.82rem" }}>
            {criteriaCount} criteria · {bidderCount} bidder{bidderCount !== 1 ? "s" : ""}
            {running ? ` · ${elapsed}s elapsed` : done ? " · complete" : " · ready"}
          </p>
        </div>
        {running && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 7,
              padding: "5px 14px",
              borderRadius: 8,
              background: "rgba(245,158,11,0.1)",
              border: "1px solid rgba(245,158,11,0.35)",
              fontSize: "0.78rem",
              fontWeight: 700,
              color: "#f59e0b",
            }}
          >
            <span className="pipeline-pulse" style={{ width: 8, height: 8, borderRadius: "50%", background: "#f59e0b", display: "inline-block" }} />
            RUNNING
          </span>
        )}
        {done && !running && (
          <span
            style={{
              padding: "5px 14px",
              borderRadius: 8,
              background: "rgba(8, 145, 178, 0.1)",
              border: "1px solid rgba(8, 145, 178, 0.32)",
              fontSize: "0.78rem",
              fontWeight: 700,
              color: "#0891b2",
            }}
          >
            ✓ COMPLETE
          </span>
        )}
      </div>

      <div style={{ display: "flex", alignItems: "flex-start", overflow: "auto", paddingBottom: 4 }}>
        {STAGES.map((s, i) => (
          <StageNode
            key={s.id}
            icon={s.icon}
            label={s.label}
            desc={s.desc}
            status={stageStatus(i)}
            isLast={i === STAGES.length - 1}
          />
        ))}
      </div>

      {!running && !done && (
        <p className="muted" style={{ marginTop: 14, fontSize: "0.82rem", textAlign: "center" }}>
          Ensure at least one bidder and the tender document are uploaded, then click{" "}
          <strong>Run Decision Engine</strong>.
        </p>
      )}
    </div>
  );
}
