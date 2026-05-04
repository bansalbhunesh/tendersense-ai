import { expect, test } from "@playwright/test";

/** Stable UUID returned by mocked POST /tenders (must match URL assertion). */
const MOCK_TENDER_ID = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

function fakeJwt(): string {
  const header = btoa(JSON.stringify({ alg: "none", typ: "JWT" }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const payload = btoa(JSON.stringify({ email: "e2e@example.com", sub: "e2e-user" }))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return `${header}.${payload}.e2e`;
}

test.describe("release smoke", () => {
  test("register → create tender → workspace → eval blocked without criteria", async ({ page }) => {
    const id = Date.now();
    const email = `e2e_smoke_${id}@example.com`;
    const password = "E2E_password_123!";
    const title = `E2E Smoke Tender ${id}`;
    const tenders: { id: string; title: string; status: string; created_at: string }[] = [];

    await page.route("**/api/v1/**", async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const apiPrefix = "/api/v1";
      const path =
        url.pathname.startsWith(apiPrefix) && url.pathname.length > apiPrefix.length
          ? url.pathname.slice(apiPrefix.length)
          : url.pathname;
      const method = req.method();

      if (method === "POST" && path === "/auth/register") {
        await route.fulfill({
          status: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: fakeJwt() }),
        });
        return;
      }

      if (method === "GET" && path === "/tenders") {
        const total = tenders.length;
        await route.fulfill({
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "X-Total-Count": String(total),
          },
          body: JSON.stringify({ tenders }),
        });
        return;
      }

      if (method === "POST" && path === "/tenders") {
        const body = req.postDataJSON() as { title?: string; description?: string };
        const tTitle = String(body?.title || "Untitled");
        tenders.length = 0;
        tenders.push({
          id: MOCK_TENDER_ID,
          title: tTitle,
          status: "open",
          created_at: new Date().toISOString(),
        });
        await route.fulfill({
          status: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        });
        return;
      }

      if (method === "GET" && path === `/tenders/${MOCK_TENDER_ID}`) {
        const row = tenders[0];
        await route.fulfill({
          status: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: MOCK_TENDER_ID,
            title: row?.title ?? title,
            status: "open",
            criteria: [],
          }),
        });
        return;
      }

      if (method === "GET" && path === `/tenders/${MOCK_TENDER_ID}/bidders`) {
        await route.fulfill({
          status: 200,
          headers: {
            "Content-Type": "application/json",
            "X-Total-Count": "0",
          },
          body: JSON.stringify({ bidders: [] }),
        });
        return;
      }

      if (method === "GET" && path.startsWith(`/tenders/${MOCK_TENDER_ID}/results`)) {
        await route.fulfill({
          status: 200,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ decisions: [], graph: null }),
        });
        return;
      }

      await route.fulfill({ status: 404, body: "e2e mock: unhandled " + method + " " + path });
    });

    await page.goto("/");

    await page.getByTestId("auth-email").fill(email);
    await page.getByTestId("auth-password").fill(password);
    await page.getByRole("button", { name: /Register mode/i }).click();
    await page.getByTestId("auth-confirm-password").fill(password);
    await page.getByTestId("auth-login").click();

    await expect(page).toHaveURL(/\/app$/);

    await page.getByTestId("tender-title").clear();
    await page.getByTestId("tender-title").fill(title);
    await page.getByTestId("tender-create").click();

    await expect(page.locator(".table tbody").getByText(title, { exact: true })).toBeVisible();

    await page
      .locator(`tr:has-text("${title}")`)
      .getByRole("link", { name: /Open Workspace/i })
      .click();

    await expect(page).toHaveURL(new RegExp(`/tender/${MOCK_TENDER_ID}$`, "i"));
    await expect(page.locator(".topbar strong")).toContainText(title);

    await page.getByTestId("tab-run").click();
    await page.getByTestId("run-evaluate").click();

    const msg = page.getByTestId("workspace-msg");
    await expect(msg).toBeVisible({ timeout: 20_000 });
    await expect(msg).toContainText(/No criteria|criteria in this tender yet/i);
  });
});
