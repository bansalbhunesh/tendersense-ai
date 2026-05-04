import { useMemo, useState } from "react";

type Decision = Record<string, unknown> & {
  verdict?: string;
  reason?: string;
  bidder_id?: string;
  criterion_id?: string;
};

type Bidder = { id: string; name: string };

type BidderScore = {
  id: string;
  name: string;
  eligible: number;
  notEligible: number;
  needsReview: number;
  conflicts: number;
  total: number;
  overallVerdict: "ELIGIBLE" | "NOT_ELIGIBLE" | "NEEDS_REVIEW" | "PENDING";
};

function computeOverall(s: BidderScore): BidderScore["overallVerdict"] {
  if (s.total === 0) return "PENDING";
  if (s.conflicts > 0 || s.needsReview > 0) return "NEEDS_REVIEW";
  if (s.notEligible > 0) return "NOT_ELIGIBLE";
  return "ELIGIBLE";
}

export default function BidderScoreboard({
  decisions,
  bidders,
  criterionLabelById,
}: {
  decisions: Decision[];
  bidders: Bidder[];
  criterionLabelById?: Map<string, string>;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  const decisionsByBidder = useMemo(() => {
    const m = new Map<string, Decision[]>();
    for (const d of decisions) {
      const bid = String(d.bidder_id || "");
      if (!m.has(bid)) m.set(bid, []);
      m.get(bid)!.push(d);
    }
    return m;
  }, [decisions]);

  if (!bidders.length || !decisions.length) return null;

  const scoreMap = new Map<string, BidderScore>();
  for (const b of bidders) {
    scoreMap.set(b.id, {
      id: b.id,
      name: b.name,
      eligible: 0,
      notEligible: 0,
      needsReview: 0,
      conflicts: 0,
      total: 0,
    } as BidderScore & { overallVerdict: never });
  }

  for (const d of decisions) {
    const bid = String(d.bidder_id || "");
    const entry = scoreMap.get(bid);
    if (!entry) continue;
    entry.total++;
    const v = String(d.verdict || "");
    if (v === "ELIGIBLE") entry.eligible++;
    else if (v === "NOT_ELIGIBLE") entry.notEligible++;
    else entry.needsReview++;
    if (String(d.reason) === "CONFLICT_DETECTED") entry.conflicts++;
  }

  const scores: BidderScore[] = [];
  for (const [, s] of scoreMap) {
    scores.push({ ...s, overallVerdict: computeOverall(s) });
  }

  const VERDICT_STYLE: Record<
    BidderScore["overallVerdict"],
    { label: string; color: string; bg: string; border: string; icon: string }
  > = {
    ELIGIBLE: {
      label: "ELIGIBLE",
      color: "#0891b2",
      bg: "rgba(8, 145, 178, 0.09)",
      border: "rgba(8, 145, 178, 0.32)",
      icon: "✓",
    },
    NOT_ELIGIBLE: {
      label: "NOT ELIGIBLE",
      color: "#ef4444",
      bg: "rgba(239,68,68,0.08)",
      border: "rgba(239,68,68,0.3)",
      icon: "✗",
    },
    NEEDS_REVIEW: {
      label: "NEEDS REVIEW",
      color: "#f59e0b",
      bg: "rgba(245,158,11,0.08)",
      border: "rgba(245,158,11,0.3)",
      icon: "⚠",
    },
    PENDING: {
      label: "PENDING",
      color: "#94a3b8",
      bg: "rgba(148,163,184,0.06)",
      border: "rgba(148,163,184,0.2)",
      icon: "—",
    },
  };

  return (
    <div className="panel" style={{ marginBottom: 20 }}>
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ margin: "0 0 3px" }}>Eligibility Scoreboard</h2>
        <p className="muted" style={{ margin: 0, fontSize: "0.82rem" }}>
          AI verdict for each bidder across all criteria — tap a row for per-criterion breakdown
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {scores.map((s) => {
          const style = VERDICT_STYLE[s.overallVerdict];
          const t = s.total || 1;
          const wE = (s.eligible / t) * 100;
          const wN = (s.notEligible / t) * 100;
          const wR = (s.needsReview / t) * 100;
          const isOpen = expanded === s.id;
          const list = decisionsByBidder.get(s.id) || [];

          return (
            <div key={s.id}>
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : s.id)}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  gap: 16,
                  alignItems: "center",
                  padding: "14px 16px",
                  borderRadius: 12,
                  background: style.bg,
                  border: `1px solid ${style.border}`,
                  transition: "border-color 0.2s",
                  width: "100%",
                  textAlign: "left",
                  cursor: "pointer",
                  font: "inherit",
                  color: "inherit",
                }}
              >
                <div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      marginBottom: 8,
                    }}
                  >
                    <span style={{ fontWeight: 700, fontSize: "0.95rem", color: "var(--text)" }}>
                      {s.name}
                    </span>
                    {s.conflicts > 0 && (
                      <span
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 4,
                          padding: "2px 8px",
                          borderRadius: 4,
                          background: "rgba(239,68,68,0.12)",
                          border: "1px solid rgba(239,68,68,0.3)",
                          fontSize: "0.65rem",
                          color: "#fca5a5",
                          fontWeight: 700,
                        }}
                      >
                        ⚡ {s.conflicts} conflict{s.conflicts > 1 ? "s" : ""} detected
                      </span>
                    )}
                  </div>

                  <div
                    style={{
                      height: 8,
                      borderRadius: 4,
                      background: "var(--progress-track)",
                      overflow: "hidden",
                      marginBottom: 6,
                      display: "flex",
                    }}
                  >
                    <div style={{ width: `${wE}%`, background: "#0891b2", transition: "width 0.5s ease" }} />
                    <div style={{ width: `${wN}%`, background: "#dc2626", transition: "width 0.5s ease" }} />
                    <div style={{ width: `${wR}%`, background: "#2563eb", transition: "width 0.5s ease" }} />
                  </div>

                  <div
                    style={{
                      display: "flex",
                      gap: 12,
                      fontSize: "0.72rem",
                      color: "var(--muted)",
                      flexWrap: "wrap",
                    }}
                  >
                    <span style={{ color: "#0e7490", fontWeight: 600 }}>✓ {s.eligible} eligible</span>
                    <span style={{ color: "#b91c1c", fontWeight: 600 }}>✗ {s.notEligible} not met</span>
                    <span style={{ color: "#1d4ed8", fontWeight: 600 }}>⚠ {s.needsReview} review</span>
                    <span>of {s.total} criteria</span>
                    <span className="muted" style={{ marginLeft: "auto" }}>
                      {isOpen ? "▲" : "▼"} details
                    </span>
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    flexDirection: "column",
                    alignItems: "center",
                    gap: 4,
                    flexShrink: 0,
                  }}
                >
                  <div
                    style={{
                      width: 52,
                      height: 52,
                      borderRadius: "50%",
                      background: style.bg,
                      border: `2px solid ${style.color}`,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: "1.3rem",
                      color: style.color,
                      fontWeight: 900,
                    }}
                  >
                    {style.icon}
                  </div>
                  <span
                    style={{
                      fontSize: "0.58rem",
                      fontWeight: 800,
                      color: style.color,
                      letterSpacing: "0.05em",
                      textAlign: "center",
                    }}
                  >
                    {style.label}
                  </span>
                </div>
              </button>

              {isOpen && (
                <div
                  style={{
                    marginTop: 6,
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid var(--border)",
                    background: "var(--surface)",
                  }}
                >
                  {list.map((d, idx) => {
                    const cid = String(d.criterion_id || "");
                    const label = criterionLabelById?.get(cid) || cid.slice(0, 8);
                    const v = String(d.verdict || "");
                    return (
                      <div
                        key={`${cid}-${idx}`}
                        className="row"
                        style={{
                          justifyContent: "space-between",
                          gap: 8,
                          padding: "6px 0",
                          borderBottom: idx < list.length - 1 ? "1px solid var(--border)" : undefined,
                          fontSize: "0.8rem",
                        }}
                      >
                        <span style={{ flex: 1, minWidth: 0 }}>{label}</span>
                        <span className="mono" style={{ fontWeight: 700, color: "var(--muted)" }}>
                          {v.replace(/_/g, " ")}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
