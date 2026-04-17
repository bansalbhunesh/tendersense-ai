type Node = {
  id: string;
  type: string;
  label: string;
  bidder_id?: string;
  confidence?: number;
};

type Edge = { from: string; to: string; label?: string };

export default function ReasoningGraph({ graph }: { graph: { nodes: Node[]; edges: Edge[] } | null }) {
  if (!graph || !graph.nodes?.length) {
    return <p className="muted">Run an evaluation to materialize the reasoning graph.</p>;
  }

  return (
    <div>
      <p className="muted" style={{ marginBottom: 12 }}>
        Directed view: each criterion links to per-bidder verdict nodes with confidence. Click a result row to read
        evidence-backed reasoning.
      </p>
      <div className="graph">
        {graph.nodes.map((n) => (
          <div key={n.id} className={`graph-node ${n.type}`}>
            <div style={{ fontWeight: 700, fontSize: "0.85rem" }}>{n.type.toUpperCase()}</div>
            <small>{n.label}</small>
            {typeof n.confidence === "number" && (
              <small>Confidence: {(n.confidence * 100).toFixed(1)}%</small>
            )}
            {n.bidder_id && <small className="mono">bidder {n.bidder_id.slice(0, 8)}…</small>}
          </div>
        ))}
      </div>
      {graph.edges?.length > 0 && (
        <div style={{ marginTop: 14 }} className="mono muted">
          {graph.edges.slice(0, 40).map((e, i) => (
            <div key={i}>
              {e.from} —{e.label ? ` ${e.label} → ` : "→ "}
              {e.to}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
