import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "./ToastProvider";

type EvidenceSnippet = {
  document?: string;
  evidence_quote?: string;
  extracted_value?: string;
  source?: string;
  text?: string;
};

type NodePayload = Record<string, unknown> & {
  evidence?: EvidenceSnippet[] | EvidenceSnippet;
  evidence_snapshot?: EvidenceSnippet;
  reasoning?: string;
  reason?: string;
};

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
  /** Optional rich payload from backend with reasoning + evidence */
  payload?: NodePayload;
};

type Edge = { from: string; to: string; label?: string };

type VerdictColor = { stroke: string; fill: string; text: string; dot: string; titleFill: string };

function verdictColors(verdict: string): VerdictColor {
  const v = verdict.toUpperCase();
  if (v === "PASS" || v === "ELIGIBLE") {
    return {
      stroke: "rgba(4, 120, 87, 0.45)",
      fill: "rgba(4, 120, 87, 0.1)",
      text: "#0f766e",
      dot: "#059669",
      titleFill: "#065f46",
    };
  }
  if (v === "FAIL" || v === "NOT_ELIGIBLE") {
    return {
      stroke: "rgba(185, 28, 28, 0.45)",
      fill: "rgba(185, 28, 28, 0.08)",
      text: "#b91c1c",
      dot: "#dc2626",
      titleFill: "#991b1b",
    };
  }
  return {
    stroke: "rgba(194, 65, 12, 0.45)",
    fill: "rgba(194, 65, 12, 0.1)",
    text: "#c2410c",
    dot: "#ea580c",
    titleFill: "#9a3412",
  };
}

function evidenceFromNode(node: Node | null): EvidenceSnippet[] {
  if (!node) return [];
  const p = node.payload;
  if (!p) return [];
  if (Array.isArray(p.evidence)) return p.evidence;
  if (p.evidence && typeof p.evidence === "object") return [p.evidence as EvidenceSnippet];
  if (p.evidence_snapshot) return [p.evidence_snapshot];
  return [];
}

function truncateText(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, Math.max(0, max - 1))}…`;
}

export default function ReasoningGraph({
  graph,
}: {
  graph: { nodes: Node[]; edges: Edge[] } | null;
}) {
  const { t } = useTranslation();
  const toast = useToast();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const nodes = graph && Array.isArray(graph.nodes) ? graph.nodes : [];
  const edges = graph && Array.isArray(graph.edges) ? graph.edges : [];

  if (!nodes.length) {
    return <p className="muted">{t("graph.emptyState")}</p>;
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

  const selectedEvidence = evidenceFromNode(selectedNode);

  async function copyAsJson() {
    if (!selectedNode) return;
    const json = JSON.stringify(selectedNode, null, 2);
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
        await navigator.clipboard.writeText(json);
      } else {
        // Fallback path — vitest jsdom may not provide clipboard.
        throw new Error("clipboard unavailable");
      }
      toast.success(t("graph.copied"));
    } catch {
      toast.error(t("graph.copied"));
    }
  }

  return (
    <div>
      <p className="muted" style={{ marginBottom: 12 }}>
        {t("graph.intro")}
      </p>

      <div
        className="row"
        data-testid="reasoning-legend"
        style={{ marginBottom: 12, gap: 14, fontSize: "0.8rem" }}
      >
        <LegendDot color="#10b981" label={t("graph.legendPass")} />
        <LegendDot color="#ef4444" label={t("graph.legendFail")} />
        <LegendDot color="#f59e0b" label={t("graph.legendReview")} />
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
                <title>{t("graph.criterionTooltip", { label: n.label })}</title>
                <rect
                  x={p.x}
                  y={p.y}
                  rx="10"
                  width={leftW}
                  height="56"
                  fill={colors.fill}
                  stroke={colors.stroke}
                />
                <text x={p.x + 10} y={p.y + 22} fill={colors.titleFill} fontSize="11" fontWeight="700">
                  {t("graph.criterionLabel")}
                </text>
                <text x={p.x + 10} y={p.y + 40} fill={colors.text} fontSize="11">
                  {summary}
                </text>
              </g>
            );
          })}
          {verdicts.map((n) => {
            const p = verdictPos.get(n.id)!;
            const verdict = String(n.label || "").toUpperCase();
            const colors = verdictColors(verdict);
            const conf = typeof n.confidence === "number"
              ? (n.confidence * 100).toFixed(0)
              : "—";
            return (
              <g
                key={n.id}
                data-testid={`graph-node-${n.id}`}
                style={{ cursor: "pointer" }}
                onClick={() => setSelectedId(n.id)}
              >
                <title>{t("graph.verdictTooltip", { verdict: n.label, percent: conf })}</title>
                <rect
                  x={p.x}
                  y={p.y}
                  rx="10"
                  width={rightW}
                  height="56"
                  fill={colors.fill}
                  stroke={colors.stroke}
                />
                <text x={p.x + 10} y={p.y + 22} fill={colors.titleFill} fontSize="11" fontWeight="700">
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
              {selectedNode.type === "criterion"
                ? t("graph.criterionDetail")
                : t("graph.verdictDetail")}
            </strong>
            <div className="row" style={{ gap: 8 }}>
              <button
                type="button"
                className="ghost"
                data-testid="reasoning-copy-json"
                onClick={copyAsJson}
              >
                {t("graph.copyAsJson")}
              </button>
              <button
                type="button"
                className="ghost"
                onClick={() => setSelectedId(null)}
                data-testid="reasoning-detail-close"
              >
                {t("common.close")}
              </button>
            </div>
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
              {t("graph.confidenceLabel", { percent: (selectedNode.confidence * 100).toFixed(1) })}
            </p>
          )}

          <div style={{ marginTop: 10 }}>
            <strong style={{ fontSize: "0.85rem" }}>{t("graph.evidenceHeading")}</strong>
            {selectedEvidence.length === 0 ? (
              <p className="muted" data-testid="reasoning-evidence-empty" style={{ marginTop: 4, fontSize: "0.85rem" }}>
                {t("graph.noEvidence")}
              </p>
            ) : (
              <div
                data-testid="reasoning-evidence-chips"
                className="row"
                style={{ marginTop: 6, flexWrap: "wrap", gap: 6 }}
              >
                {selectedEvidence.map((ev, i) => {
                  const text = ev.evidence_quote || ev.extracted_value || ev.text || ev.source || "";
                  const truncated = truncateText(text, 80);
                  const fullText = ev.document ? `${ev.document}: ${text}` : text;
                  return (
                    <span
                      key={i}
                      data-testid="reasoning-evidence-chip"
                      title={fullText}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        padding: "4px 10px",
                        borderRadius: 999,
                        background: "rgba(148,163,184,0.15)",
                        border: "1px solid var(--border, rgba(148,163,184,0.35))",
                        fontSize: "0.75rem",
                        maxWidth: "100%",
                      }}
                    >
                      {ev.document && (
                        <strong style={{ fontSize: "0.7rem" }}>{ev.document}</strong>
                      )}
                      <span className="mono muted" style={{ fontSize: "0.7rem" }}>
                        {truncated}
                      </span>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
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
