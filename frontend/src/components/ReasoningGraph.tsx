type Node = {
  id: string;
  type: string;
  label: string;
  bidder_id?: string;
  confidence?: number;
};

type Edge = { from: string; to: string; label?: string };

export default function ReasoningGraph({ graph }: { graph: { nodes: Node[]; edges: Edge[] } | null }) {
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

  return (
    <div>
      <p className="muted" style={{ marginBottom: 12 }}>
        Directed view: criteria (left) linking to bidder verdicts (right) with confidence.
      </p>
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
            return (
              <g key={n.id}>
                <title>{n.label}</title>
                <rect x={p.x} y={p.y} rx="10" width={leftW} height="56" fill="rgba(17,24,39,0.85)" stroke="rgba(245,158,11,0.45)" />
                <text x={p.x + 10} y={p.y + 22} fill="#f9fafb" fontSize="11" fontWeight="700">
                  CRITERION
                </text>
                <text x={p.x + 10} y={p.y + 40} fill="#d1d5db" fontSize="11">
                  {n.label.slice(0, 85)}
                </text>
              </g>
            );
          })}
          {verdicts.map((n) => {
            const p = verdictPos.get(n.id)!;
            const verdict = String(n.label || "").toUpperCase();
            const stroke =
              verdict === "ELIGIBLE"
                ? "rgba(16,185,129,0.55)"
                : verdict === "NOT_ELIGIBLE"
                  ? "rgba(239,68,68,0.55)"
                  : "rgba(59,130,246,0.55)";
            const confidenceColor =
              verdict === "ELIGIBLE" ? "#6ee7b7" : verdict === "NOT_ELIGIBLE" ? "#fda4af" : "#93c5fd";
            return (
              <g key={n.id}>
                <title>{`${n.label} • ${n.bidder_id ?? ""}`}</title>
                <rect x={p.x} y={p.y} rx="10" width={rightW} height="56" fill="rgba(17,24,39,0.85)" stroke={stroke} />
                <text x={p.x + 10} y={p.y + 22} fill="#f9fafb" fontSize="11" fontWeight="700">
                  {n.label}
                </text>
                <text x={p.x + 10} y={p.y + 40} fill={confidenceColor} fontSize="11">
                  {n.bidder_id ? `bidder ${n.bidder_id.slice(0, 8)}...` : ""}
                  {typeof n.confidence === "number" ? `  conf ${(n.confidence * 100).toFixed(0)}%` : ""}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
