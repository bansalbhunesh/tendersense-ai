import { useState } from "react";

type Node = {
  id: string;
  type: string;
  label: string;
  bidder_id?: string;
  confidence?: number;
  /** Optional plain-language reason / criterion summary surfaced from backend */
  reason?: string;
  /** Optional full criterion text (raw from tender) */
  text_raw?: string;
};

type Edge = { from: string; to: string; label?: string };

type VerdictColor = { stroke: string; fill: string; text: string; dot: string };

function verdictColors(verdict: string): VerdictColor {
  const v = verdict.toUpperCase();
  if (v === "PASS" || v === "ELIGIBLE") {
    return {
      stroke: "rgba(16,185,129,0.7)",
      fill: "rgba(16,185,129,0.15)",
      text: "#6ee7b7",
      dot: "#10b981",
    };
  }
  if (v === "FAIL" || v === "NOT_ELIGIBLE") {
    return {
      stroke: "rgba(239,68,68,0.7)",
      fill: "rgba(239,68,68,0.15)",
      text: "#fda4af",
      dot: "#ef4444",
    };
  }
  // NEEDS_REVIEW + anything ambiguous → amber
  return {
    stroke: "rgba(245,158,11,0.7)",
    fill: "rgba(245,158,11,0.15)",
    text: "#fcd34d",
    dot: "#f59e0b",
  };
}

export default function ReasoningGraph({
  graph,
}: {
  graph: { nodes: Node[]; edges: Edge[] } | null;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = graph && Array.isArray(graph.edges) ? graph.edges : [];

  if (!nodes.length) {
    return <p className="muted">Run an evaluation to materialize the reasoning graph.</p>;
  }

  const criteria = nodes.filter((n) => n.type === "criterion");
  const verdicts = nodes.filter((n) => n.type !== "criterion");
  const leftW = 340;
  const rightW = 340;
  const rowH = 120;
  const width = leftW + rightW + 80;

  const edgeFromByTo = new Map<string, string>();
  edges.forEach((e) => edgeFromByTo.set(e.to, e.from));
  const verdictsByCriterion = new Map<string, Node[]>();
  verdicts.forEach((v) => {
    const c = edgeFromByTo.get(v.id);
    if (!c) return;
    const arr = verdictsByCriterion.get(c) || [];
    arr.push(v);
    verdictsByCriterion.set(c, arr);
  });
  const rows = Math.max(
    1,
    criteria.reduce((acc, c) => {
      const n = (verdictsByCriterion.get(c.id) || []).length;
      return acc + Math.max(1, n);
    }, 0),
  );
  const height = rows * rowH + 40;
  const yFor = (idx: number) => 30 + idx * rowH + 40;
  const criterionPos = new Map<string, { x: number; y: number }>();
  const verdictPos = new Map<string, { x: number; y: number }>();
  let row = 0;
  criteria.forEach((c) => {
    const list = verdictsByCriterion.get(c.id) || [];
    const span = Math.max(1, list.length);
    const center = row + Math.floor((span - 1) / 2);
    criterionPos.set(c.id, { x: 20, y: yFor(center) });
    if (list.length === 0) {
      row += 1;
      return;
    }
    list.forEach((v, i) => verdictPos.set(v.id, { x: leftW + 60, y: yFor(row + i) }));
    row += span;
  });

  const selectedNode =
    selectedId != null ? nodes.find((n) => n.id === selectedId) || null : null;

  return (
    <div>
      <p className="muted" style={{ marginBottom: 12 }}>
        Directed view: criteria (left) linking to bidder verdicts (right) with confidence.
      </p>

      <div
        className="row"
        data-testid="reasoning-legend"
        style={{ marginBottom: 12, gap: 14, fontSize: "0.8rem" }}
      >
        <LegendDot color="#10b981" label="PASS / ELIGIBLE" />
        <LegendDot color="#ef4444" label="FAIL / NOT ELIGIBLE" />
        <LegendDot color="#f59e0b" label="NEEDS REVIEW" />
      </div>

      <div style={{ overflow: "auto", maxHeight: 620 }}>
        <svg
          width="100%"
          viewBox={`0 0 ${width} ${height}`}
          height={Math.min(height, 620)}
          preserveAspectRatio="xMinYMin meet"
          style={{ display: "block", marginBottom: 12 }}
        >
          {edges.map((e, i) => {
            const from = criterionPos.get(e.from);
            const to = verdictPos.get(e.to);
            if (!from || !to) return null;
            const x1 = from.x + leftW - 16;
            const y1 = from.y + 28;
            const x2 = to.x + 16;
            const y2 = to.y + 28;
            const mid = x1 + (x2 - x1) * 0.55;
            const d = `M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`;
            return (
              <path
                key={`${e.from}-${e.to}-${i}`}
                d={d}
                fill="none"
                stroke="rgba(148,163,184,0.55)"
                strokeWidth="1.5"
              />
            );
          })}
          {criteria.map((n) => {
            const p = criterionPos.get(n.id)!;
            // Color the criterion node based on the worst verdict among its
            // attached verdict children. This makes the graph readable at a
            // glance: a single FAIL anywhere downstream paints the criterion
            // red, otherwise NEEDS_REVIEW > PASS dominates.
            const downstream = (verdictsByCriterion.get(n.id) || []).map((v) =>
              String(v.label || "").toUpperCase(),
            );
            let agg = "PASS";
            if (downstream.some((v) => v === "FAIL" || v === "NOT_ELIGIBLE")) agg = "FAIL";
            else if (downstream.some((v) => v === "NEEDS_REVIEW")) agg = "NEEDS_REVIEW";
            else if (downstream.some((v) => v === "PASS" || v === "ELIGIBLE")) agg = "PASS";
            else agg = "NEEDS_REVIEW";
            const colors = verdictColors(agg);
            const summary = (n.reason || n.label || "").slice(0, 90);
            return (
              <g
                key={n.id}
                data-testid={`graph-node-${n.id}`}
                style={{ cursor: "pointer" }}
                onClick={() => setSelectedId(n.id)}
              >
                <title>{n.label}</title>
                <rect
                  x={p.x}
                  y={p.y}
                  rx="10"
                  width={leftW}
                  height="56"
                  fill={colors.fill}
                  stroke={colors.stroke}
                />
                <text x={p.x + 10} y={p.y + 22} fill="#f9fafb" fontSize="11" fontWeight="700">
                  CRITERION
                </text>
                <text x={p.x + 10} y={p.y + 40} fill="#d1d5db" fontSize="11">
                  {summary}
                </text>
              </g>
            );
          })}
          {verdicts.map((n) => {
            const p = verdictPos.get(n.id)!;
            const verdict = String(n.label || "").toUpperCase();
            const colors = verdictColors(verdict);
            return (
              <g
                key={n.id}
                data-testid={`graph-node-${n.id}`}
                style={{ cursor: "pointer" }}
                onClick={() => setSelectedId(n.id)}
              >
                <title>{`${n.label} • ${n.bidder_id ?? ""}`}</title>
                <rect
                  x={p.x}
                  y={p.y}
                  rx="10"
                  width={rightW}
                  height="56"
                  fill={colors.fill}
                  stroke={colors.stroke}
                />
                <text x={p.x + 10} y={p.y + 22} fill="#f9fafb" fontSize="11" fontWeight="700">
                  {n.label}
                </text>
                <text x={p.x + 10} y={p.y + 40} fill={colors.text} fontSize="11">
                  {n.bidder_id ? `bidder ${n.bidder_id.slice(0, 8)}...` : ""}
                  {typeof n.confidence === "number"
                    ? `  conf ${(n.confidence * 100).toFixed(0)}%`
                    : ""}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {selectedNode && (
        <div
          className="panel"
          data-testid="reasoning-detail"
          style={{ marginTop: 12, padding: 16 }}
        >
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 8 }}>
            <strong>
              {selectedNode.type === "criterion" ? "Criterion" : "Verdict"} detail
            </strong>
            <button
              type="button"
              className="ghost"
              onClick={() => setSelectedId(null)}
              data-testid="reasoning-detail-close"
            >
              Close
            </button>
          </div>
          <p className="muted" style={{ marginTop: 0 }}>
            {selectedNode.text_raw || selectedNode.label}
          </p>
          {selectedNode.reason && (
            <p className="mono" style={{ fontSize: "0.85rem" }}>
              {selectedNode.reason}
            </p>
          )}
          {typeof selectedNode.confidence === "number" && (
            <p className="mono muted" style={{ fontSize: "0.8rem" }}>
              confidence {(selectedNode.confidence * 100).toFixed(1)}%
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        aria-hidden
        style={{
          width: 10,
          height: 10,
          borderRadius: 999,
          background: color,
          display: "inline-block",
        }}
      />
      <span className="muted">{label}</span>
    </span>
  );
}
