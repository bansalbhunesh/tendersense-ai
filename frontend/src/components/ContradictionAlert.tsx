type Decision = Record<string, unknown> & {
  verdict?: string;
  reasoning?: string;
  reason?: string;
  confidence?: number;
  criterion_id?: string;
  bidder_id?: string;
};

const CONFLICT_RE = /conflict|contradict|mismatch|inconsist|manipul|discrepan/i;

export default function ContradictionAlert({
  decisions,
  bidderNameMap,
  criterionLabelById,
}: {
  decisions: Decision[];
  bidderNameMap: Map<string, string>;
  criterionLabelById: Map<string, string>;
}) {
  const conflicts = decisions.filter((d) =>
    CONFLICT_RE.test(String(d.reasoning || d.reason || ""))
  );

  if (!conflicts.length) return null;

  return (
    <div
      style={{
        borderRadius: 12,
        border: "1px solid rgba(239,68,68,0.5)",
        background:
          "linear-gradient(135deg, rgba(239,68,68,0.09) 0%, rgba(239,68,68,0.04) 100%)",
        padding: 20,
        marginBottom: 20,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <span
        className="pulse-dot"
        style={{
          position: "absolute",
          top: 18,
          right: 18,
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: "#ef4444",
          display: "block",
        }}
      />

      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: 10,
            background: "rgba(239,68,68,0.12)",
            border: "1px solid rgba(239,68,68,0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: "1.3rem",
            flexShrink: 0,
          }}
        >
          ⚡
        </div>

        <div style={{ flex: 1 }}>
          <div
            style={{
              fontWeight: 800,
              color: "#fca5a5",
              fontSize: "0.9rem",
              letterSpacing: "0.04em",
              marginBottom: 6,
            }}
          >
            MANIPULATION SIGNAL DETECTED
          </div>
          <p style={{ margin: "0 0 14px", color: "var(--muted)", fontSize: "0.85rem" }}>
            AI identified {conflicts.length} potential contradiction
            {conflicts.length > 1 ? "s" : ""} in submitted documents.
            {" "}These cannot be auto-approved — mandatory officer review required.
          </p>

          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {conflicts.slice(0, 4).map((d, i) => {
              const cid = String(d.criterion_id || "");
              const bid = String(d.bidder_id || "");
              const label = criterionLabelById.get(cid) || `criterion ${cid.slice(0, 8)}…`;
              const bidderName = bidderNameMap.get(bid) || `${bid.slice(0, 8)}…`;
              const reason = String(d.reasoning || d.reason || "");
              const conf = Number(d.confidence || 0);
              return (
                <div
                  key={i}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 8,
                    background: "rgba(239,68,68,0.06)",
                    border: "1px solid rgba(239,68,68,0.2)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      marginBottom: 6,
                      gap: 8,
                      flexWrap: "wrap",
                    }}
                  >
                    <span style={{ fontWeight: 700, fontSize: "0.82rem", color: "#f9fafb" }}>
                      {label.length > 70 ? `${label.slice(0, 67)}…` : label}
                    </span>
                    <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                      <span
                        className="badge"
                        style={{
                          background: "rgba(239,68,68,0.1)",
                          color: "#ef4444",
                          border: "1px solid rgba(239,68,68,0.25)",
                          fontSize: "0.65rem",
                          padding: "2px 8px",
                        }}
                      >
                        {bidderName}
                      </span>
                      <span
                        className="badge"
                        style={{
                          background: "rgba(245,158,11,0.1)",
                          color: "#f59e0b",
                          border: "1px solid rgba(245,158,11,0.25)",
                          fontSize: "0.65rem",
                          padding: "2px 8px",
                        }}
                      >
                        conf {(conf * 100).toFixed(0)}%
                      </span>
                    </div>
                  </div>
                  <p
                    className="mono"
                    style={{
                      margin: 0,
                      fontSize: "0.75rem",
                      color: "var(--muted)",
                      lineHeight: 1.5,
                    }}
                  >
                    {reason.length > 200 ? `${reason.slice(0, 197)}…` : reason}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
