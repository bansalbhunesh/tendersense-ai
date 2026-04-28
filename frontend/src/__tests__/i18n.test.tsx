import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n, { LANG_STORAGE_KEY } from "../i18n";
import AppHeader from "../components/AppHeader";
import { ToastProvider } from "../components/ToastProvider";

vi.mock("../api", () => ({
  logout: vi.fn(),
  token: vi.fn(() => null),
}));

function renderHeader() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <AppHeader left={<strong>brand</strong>} />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("i18n", () => {
  beforeEach(async () => {
    localStorage.clear();
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });

  afterEach(async () => {
    if (i18n.language !== "en") {
      await i18n.changeLanguage("en");
    }
  });

  it("returns English by default and Hindi after changeLanguage", async () => {
    expect(i18n.t("auth.signIn")).toBe("Sign in");
    await i18n.changeLanguage("hi");
    expect(i18n.t("auth.signIn")).toBe("साइन इन");
  });

  it("renders English log out label by default in AppHeader", () => {
    renderHeader();
    expect(screen.getByTestId("header-logout")).toHaveTextContent(/Log out/);
  });

  it("toggles AppHeader rendered text from EN to Hindi when हिं is clicked", async () => {
    const user = userEvent.setup();
    renderHeader();
    expect(screen.getByTestId("header-logout")).toHaveTextContent(/Log out/);

    await user.click(screen.getByTestId("lang-toggle-hi"));
    expect(screen.getByTestId("header-logout")).toHaveTextContent("लॉग आउट");

    await user.click(screen.getByTestId("lang-toggle-en"));
    expect(screen.getByTestId("header-logout")).toHaveTextContent(/Log out/);
  });

  it("persists the chosen language to localStorage under ts_lang", async () => {
    const user = userEvent.setup();
    renderHeader();
    await user.click(screen.getByTestId("lang-toggle-hi"));
    expect(localStorage.getItem(LANG_STORAGE_KEY)).toBe("hi");
    await user.click(screen.getByTestId("lang-toggle-en"));
    expect(localStorage.getItem(LANG_STORAGE_KEY)).toBe("en");
  });

  it("marks the active language toggle with aria-pressed", async () => {
    const user = userEvent.setup();
    renderHeader();
    expect(screen.getByTestId("lang-toggle-en").getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByTestId("lang-toggle-hi").getAttribute("aria-pressed")).toBe("false");
    await user.click(screen.getByTestId("lang-toggle-hi"));
    expect(screen.getByTestId("lang-toggle-en").getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByTestId("lang-toggle-hi").getAttribute("aria-pressed")).toBe("true");
  });
});
