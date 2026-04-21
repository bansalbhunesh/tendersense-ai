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

  return (
    <div>
      <p className="muted" style={{ marginBottom: 12 }}>
        Directed view: each criterion links to per-bidder verdict nodes with confidence. Click a result row to read
        evidence-backed reasoning.
      </p>
      <div className="graph">
        {nodes.map((n) => (
          <div key={n.id} className={`graph-node ${n.type}`}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
              <div style={{ fontWeight: 800, fontSize: "0.7rem", opacity: 0.6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                {n.type}
              </div>
              {typeof n.confidence === "number" && (
                <span className={`badge ${n.confidence > 0.8 ? 'ok' : 'review'}`} style={{ fontSize: '0.65rem', padding: '2px 6px' }}>
                  {(n.confidence * 100).toFixed(0)}%
                </span>
              )}
            </div>
            <div style={{ fontSize: '0.9rem', marginBottom: 8 }}>{n.label}</div>
            {n.bidder_id && (
              <div className="mono" style={{ fontSize: '0.7rem', opacity: 0.6 }}>
                Bidder: {n.bidder_id.slice(0, 8)}…
              </div>
            )}
          </div>
        ))}
      </div>
      {edges.length > 0 && (
        <div style={{ marginTop: 14 }} className="mono muted">
          {edges.slice(0, 40).map((e, i) => (
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
