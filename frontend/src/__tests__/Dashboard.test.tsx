import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Dashboard from "../pages/Dashboard";
import { ToastProvider } from "../components/ToastProvider";

vi.mock("../api", () => ({
  apiFetch: vi.fn(),
  apiFetchWithMeta: vi.fn(),
  logout: vi.fn(),
  token: vi.fn(() => "fake.jwt.token"),
}));

import * as api from "../api";

function renderDashboard() {
  return render(
    <MemoryRouter>
      <ToastProvider>
        <Dashboard />
      </ToastProvider>
    </MemoryRouter>,
  );
}

describe("Dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.token as ReturnType<typeof vi.fn>).mockReturnValue("fake.jwt.token");
  });

  it("shows the empty-state row when no tenders are returned", async () => {
    (api.apiFetchWithMeta as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: { tenders: [] },
      totalCount: 0,
    });
    renderDashboard();
    expect(await screen.findByTestId("tenders-empty")).toBeInTheDocument();
  });

  it("renders a tender row when one is returned", async () => {
    (api.apiFetchWithMeta as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: {
        tenders: [
          { id: "t-1", title: "Road resurfacing", status: "open", created_at: "2025-01-01" },
        ],
      },
      totalCount: 1,
    });
    renderDashboard();
    expect(await screen.findByText("Road resurfacing")).toBeInTheDocument();
    expect(screen.getByText("open")).toBeInTheDocument();
  });

  it("hides pagination when X-Total-Count header is absent", async () => {
    (api.apiFetchWithMeta as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: { tenders: [] },
      totalCount: null,
    });
    renderDashboard();
    await waitFor(() =>
      expect(screen.queryByTestId("tenders-pagination")).toBeNull(),
    );
  });

  it("shows pagination controls when X-Total-Count is present", async () => {
    (api.apiFetchWithMeta as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      data: {
        tenders: [
          { id: "t-1", title: "A", status: "open", created_at: "2025-01-01" },
        ],
      },
      totalCount: 200,
    });
    renderDashboard();
    expect(await screen.findByTestId("tenders-pagination")).toBeInTheDocument();
    expect(screen.getByTestId("tenders-page-size")).toBeInTheDocument();
  });
});
