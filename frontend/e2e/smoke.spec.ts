import { expect, test } from "@playwright/test";

test.describe("release smoke", () => {
  test("register → create tender → workspace → eval blocked without criteria", async ({ page }) => {
    const id = Date.now();
    const email = `e2e_smoke_${id}@example.com`;
    const password = "E2E_password_123!";
    const title = `E2E Smoke Tender ${id}`;

    await page.goto("/");

    await page.getByTestId("auth-email").fill(email);
    await page.getByTestId("auth-password").fill(password);
    await page.getByTestId("auth-register").click();

    await expect(page).toHaveURL(/\/app$/);

    await page.getByTestId("tender-title").clear();
    await page.getByTestId("tender-title").fill(title);
    await page.getByTestId("tender-create").click();

    await expect(page.locator(".table tbody").getByText(title, { exact: true })).toBeVisible();

    await page.locator(`tr:has-text("${title}")`).getByRole("button", { name: /Open Workspace/ }).click();

    await expect(page).toHaveURL(/\/tender\/[0-9a-f-]{36}$/i);
    await expect(page.locator(".topbar strong")).toContainText(title);

    await page.getByTestId("tab-run").click();
    await page.getByTestId("run-evaluate").click();

    const msg = page.getByTestId("workspace-msg");
    await expect(msg).toBeVisible({ timeout: 20_000 });
    await expect(msg).toContainText(/No criteria|criteria in this tender yet/i);
  });
});
