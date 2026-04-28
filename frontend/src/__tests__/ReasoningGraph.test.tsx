import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import ReasoningGraph from "../components/ReasoningGraph";
import { ToastProvider } from "../components/ToastProvider";

const sampleGraph = {
  nodes: [
    { id: "c1", type: "criterion", label: "Criterion: turnover ≥ 5 Cr", reason: "Annual turnover threshold" },
    { id: "v1", type: "verdict", label: "PASS", bidder_id: "bidder-aaaaa", confidence: 0.92 },
    { id: "v2", type: "verdict", label: "FAIL", bidder_id: "bidder-bbbbb", confidence: 0.41 },
    {
      id: "v3",
      type: "verdict",
      label: "NEEDS_REVIEW",
      bidder_id: "bidder-ccccc",
      confidence: 0.62,
      payload: {
        evidence: [
          { document: "ca_certificate.pdf", evidence_quote: "Annual turnover stated as INR 4.7 Cr for FY23." },
          { document: "balance_sheet.pdf", extracted_value: "₹4.72 Cr" },
        ],
      },
    },
  ],
  edges: [
    { from: "c1", to: "v1" },
    { from: "c1", to: "v2" },
    { from: "c1", to: "v3" },
  ],
};

function renderGraph(graph: typeof sampleGraph | null) {
  return render(
    <ToastProvider>
      <ReasoningGraph graph={graph as never} />
    </ToastProvider>,
  );
}

describe("ReasoningGraph", () => {
  it("renders empty-state when given a null graph", () => {
    renderGraph(null);
    expect(
      screen.getByText("Run an evaluation to materialize the reasoning graph."),
    ).toBeInTheDocument();
  });

  it("renders one rect per node", () => {
    const { container } = renderGraph(sampleGraph);
    expect(container.querySelectorAll("[data-testid^='graph-node-']")).toHaveLength(4);
  });

  it("renders the legend with three swatches", () => {
    renderGraph(sampleGraph);
    const legend = screen.getByTestId("reasoning-legend");
    expect(legend).toHaveTextContent(/PASS/);
    expect(legend).toHaveTextContent(/FAIL/);
    expect(legend).toHaveTextContent(/NEEDS REVIEW/);
  });

  it("uses verdict-aware stroke colors for PASS / FAIL / NEEDS_REVIEW", () => {
    const { container } = renderGraph(sampleGraph);
    const pass = container.querySelector("[data-testid='graph-node-v1'] rect")!;
    const fail = container.querySelector("[data-testid='graph-node-v2'] rect")!;
    const review = container.querySelector("[data-testid='graph-node-v3'] rect")!;
    expect(pass.getAttribute("stroke")).toMatch(/4,\s*120,\s*87/); // emerald
    expect(fail.getAttribute("stroke")).toMatch(/185,\s*28,\s*28/); // red
    expect(review.getAttribute("stroke")).toMatch(/194,\s*65,\s*12/); // amber
  });

  it("opens a detail panel when a node is clicked", async () => {
    const user = userEvent.setup();
    renderGraph(sampleGraph);
    expect(screen.queryByTestId("reasoning-detail")).toBeNull();
    await user.click(screen.getByTestId("graph-node-v1"));
    expect(screen.getByTestId("reasoning-detail")).toBeInTheDocument();
    expect(screen.getByTestId("reasoning-detail")).toHaveTextContent("PASS");
  });

  it("renders an SVG <title> with verdict + confidence on each verdict node", () => {
    const { container } = renderGraph(sampleGraph);
    const passTitle = container.querySelector("[data-testid='graph-node-v1'] title");
    expect(passTitle?.textContent).toMatch(/PASS/);
    expect(passTitle?.textContent).toMatch(/92/);
  });

  it("renders evidence chips when payload supplies evidence", async () => {
    const user = userEvent.setup();
    renderGraph(sampleGraph);
    await user.click(screen.getByTestId("graph-node-v3"));
    const chips = screen.getAllByTestId("reasoning-evidence-chip");
    expect(chips.length).toBe(2);
    expect(chips[0]).toHaveTextContent(/ca_certificate.pdf/);
    expect(chips[0]).toHaveTextContent(/Annual turnover/);
  });

  it("falls back to a 'no evidence' notice when payload has none", async () => {
    const user = userEvent.setup();
    renderGraph(sampleGraph);
    await user.click(screen.getByTestId("graph-node-v1"));
    expect(screen.getByTestId("reasoning-evidence-empty")).toBeInTheDocument();
  });

  it("copies the selected node JSON via navigator.clipboard.writeText", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      writable: true,
      value: { writeText },
    });

    renderGraph(sampleGraph);
    fireEvent.click(screen.getByTestId("graph-node-v3"));
    const copyButton = await screen.findByTestId("reasoning-copy-json");
    fireEvent.click(copyButton);

    // copyAsJson is async; let the microtask queue drain so the spy receives the call.
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledTimes(1);
    const arg = writeText.mock.calls[0][0] as string;
    const parsed = JSON.parse(arg);
    expect(parsed.id).toBe("v3");
    expect(parsed.label).toBe("NEEDS_REVIEW");
  });
});
