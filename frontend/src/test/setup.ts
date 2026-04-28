import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import i18n from "../i18n";

beforeEach(async () => {
  // Ensure each test starts in English so visible-text assertions stay stable.
  if (i18n.language !== "en") {
    await i18n.changeLanguage("en");
  }
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.clearAllMocks();
});
