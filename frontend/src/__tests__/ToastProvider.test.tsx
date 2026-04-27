import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider, useToast } from "../components/ToastProvider";

// Smuggle the toast api out of the provider so tests can drive it
// directly without battling userEvent + fake-timer interactions.
let toastRef: ReturnType<typeof useToast> | null = null;
function Capture() {
  toastRef = useToast();
  return null;
}

function renderHarness() {
  return render(
    <ToastProvider>
      <Capture />
    </ToastProvider>,
  );
}

describe("ToastProvider", () => {
  beforeEach(() => {
    toastRef = null;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders an empty stack initially", () => {
    renderHarness();
    expect(screen.getByTestId("toast-stack").children).toHaveLength(0);
  });

  it("pushes success and error toasts side by side", () => {
    renderHarness();
    act(() => {
      toastRef!.success("yay");
      toastRef!.error("boo");
    });
    expect(screen.getByTestId("toast-success")).toHaveTextContent("yay");
    expect(screen.getByTestId("toast-error")).toHaveTextContent("boo");
    expect(screen.getByTestId("toast-stack").children).toHaveLength(2);
  });

  it("auto-dismisses toasts after 4 seconds", () => {
    renderHarness();
    act(() => {
      toastRef!.info("hmm");
    });
    expect(screen.getByTestId("toast-info")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4001);
    });
    expect(screen.queryByTestId("toast-info")).toBeNull();
  });

  it("dismiss(id) removes a toast immediately", () => {
    renderHarness();
    act(() => {
      toastRef!.success("first");
    });
    const stack = screen.getByTestId("toast-stack");
    expect(stack.children).toHaveLength(1);
    act(() => {
      toastRef!.dismiss(1);
    });
    expect(stack.children).toHaveLength(0);
  });

  it("throws a clear error when useToast is called outside a provider", () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    function Bare() {
      useToast();
      return null;
    }
    expect(() => render(<Bare />)).toThrow(/useToast must be used inside a ToastProvider/);
    errSpy.mockRestore();
  });
});
