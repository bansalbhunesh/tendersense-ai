import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import ReasoningGraph from "../components/ReasoningGraph";

const sampleGraph = {
  nodes: [
    { id: "c1", type: "criterion", label: "Criterion: turnover ≥ 5 Cr", reason: "Annual turnover threshold" },
    { id: "v1", type: "verdict", label: "PASS", bidder_id: "bidder-aaaaa", confidence: 0.92 },
    { id: "v2", type: "verdict", label: "FAIL", bidder_id: "bidder-bbbbb", confidence: 0.41 },
    { id: "v3", type: "verdict", label: "NEEDS_REVIEW", bidder_id: "bidder-ccccc", confidence: 0.62 },
  ],
  edges: [
    { from: "c1", to: "v1" },
    { from: "c1", to: "v2" },
    { from: "c1", to: "v3" },
  ],
};

describe("ReasoningGraph", () => {
  it("renders empty-state when given a null graph", () => {
    render(<ReasoningGraph graph={null} />);
    expect(
      screen.getByText("Run an evaluation to materialize the reasoning graph."),
    ).toBeInTheDocument();
  });

  it("renders one rect per node", () => {
    const { container } = render(<ReasoningGraph graph={sampleGraph} />);
    expect(container.querySelectorAll("[data-testid^='graph-node-']")).toHaveLength(4);
  });

  it("renders the legend with three swatches", () => {
    render(<ReasoningGraph graph={sampleGraph} />);
    const legend = screen.getByTestId("reasoning-legend");
    expect(legend).toHaveTextContent(/PASS/);
    expect(legend).toHaveTextContent(/FAIL/);
    expect(legend).toHaveTextContent(/NEEDS REVIEW/);
  });

  it("uses verdict-aware stroke colors for PASS / FAIL / NEEDS_REVIEW", () => {
    const { container } = render(<ReasoningGraph graph={sampleGraph} />);
    const pass = container.querySelector("[data-testid='graph-node-v1'] rect")!;
    const fail = container.querySelector("[data-testid='graph-node-v2'] rect")!;
    const review = container.querySelector("[data-testid='graph-node-v3'] rect")!;
    expect(pass.getAttribute("stroke")).toMatch(/16,185,129/); // green
    expect(fail.getAttribute("stroke")).toMatch(/239,68,68/); // red
    expect(review.getAttribute("stroke")).toMatch(/245,158,11/); // amber
  });

  it("opens a detail panel when a node is clicked", async () => {
    const user = userEvent.setup();
    render(<ReasoningGraph graph={sampleGraph} />);
    expect(screen.queryByTestId("reasoning-detail")).toBeNull();
    await user.click(screen.getByTestId("graph-node-v1"));
    expect(screen.getByTestId("reasoning-detail")).toBeInTheDocument();
    expect(screen.getByTestId("reasoning-detail")).toHaveTextContent("PASS");
  });
});
