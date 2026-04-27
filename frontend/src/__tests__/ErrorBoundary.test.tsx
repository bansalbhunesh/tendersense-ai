import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ErrorBoundary from "../components/ErrorBoundary";

function Boom(): JSX.Element {
  throw new Error("kaboom inside child");
}

describe("ErrorBoundary", () => {
  let errSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // React logs the thrown error to console.error during the boundary path.
    // Silence it so test output stays clean.
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errSpy.mockRestore();
  });

  it("renders the fallback UI when a child throws", () => {
    render(
      <ErrorBoundary>
        <Boom />
      </ErrorBoundary>,
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("kaboom inside child")).toBeInTheDocument();
  });

  it("renders children unchanged when nothing throws", () => {
    render(
      <ErrorBoundary>
        <p>healthy child</p>
      </ErrorBoundary>,
    );
    expect(screen.getByText("healthy child")).toBeInTheDocument();
  });
});
