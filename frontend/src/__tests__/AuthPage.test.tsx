import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AuthPage from "../pages/AuthPage";
import { ToastProvider } from "../components/ToastProvider";

vi.mock("../api", () => ({
  login: vi.fn(),
  register: vi.fn(),
  token: vi.fn(() => null),
}));

import * as api from "../api";

function renderPage() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <AuthPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("AuthPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.token as ReturnType<typeof vi.fn>).mockReturnValue(null);
  });

  it("starts with empty email and password fields", () => {
    renderPage();
    const email = screen.getByTestId("auth-email") as HTMLInputElement;
    const password = screen.getByTestId("auth-password") as HTMLInputElement;
    expect(email.value).toBe("");
    expect(password.value).toBe("");
  });

  it("does not render the demo-fill button when no demo email env is set", () => {
    renderPage();
    expect(screen.queryByTestId("auth-fill-demo")).toBeNull();
  });

  it("accepts typed email + password and submits via login", async () => {
    (api.login as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByTestId("auth-email"), "officer@example.com");
    await user.type(screen.getByTestId("auth-password"), "hunter22");
    await user.click(screen.getByTestId("auth-login"));

    expect(api.login).toHaveBeenCalledWith("officer@example.com", "hunter22");
    expect(api.register).not.toHaveBeenCalled();
  });

  it("calls register when register button clicked", async () => {
    (api.register as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByTestId("auth-email"), "new@example.com");
    await user.type(screen.getByTestId("auth-password"), "freshpass");
    await user.click(screen.getByTestId("auth-register"));

    expect(api.register).toHaveBeenCalledWith("new@example.com", "freshpass");
    expect(api.login).not.toHaveBeenCalled();
  });

  it("renders an inline error when login throws", async () => {
    (api.login as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("nope"));
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByTestId("auth-email"), "x@y.z");
    await user.type(screen.getByTestId("auth-password"), "abc");
    await user.click(screen.getByTestId("auth-login"));

    const err = await screen.findByTestId("auth-error");
    expect(err).toHaveTextContent("nope");
  });
});
