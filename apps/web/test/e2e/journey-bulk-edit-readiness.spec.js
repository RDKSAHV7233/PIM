/**
 * Journey 5: Bulk Edit → Compliance → Channel Readiness
 *
 * Ship gate test. Exercises the catalog operations → quality → channels pipeline:
 *   editor uses bulk edit → checks quality completeness → channel_manager checks readiness
 */
const { test, expect } = require("@playwright/test");
const {
  apiLogin,
  loginViaUi,
} = require("./helpers/vexa-pim.cjs");

test.describe("Journey: Bulk Edit → Compliance → Readiness", () => {
  test("editor can navigate to bulk edit and see scope filters", async ({ page }) => {
    await loginViaUi(page, "editor");
    await page.goto("/operations/bulk-edit", { waitUntil: "domcontentloaded" });

    await expect(page.locator("main")).toBeVisible();
    // Should see scope/filter controls
    await expect(
      page.getByText(/scope|filter|category|brand|status/i).first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test("editor can view quality completeness page", async ({ page }) => {
    await loginViaUi(page, "editor");
    await page.goto("/quality/completeness", { waitUntil: "domcontentloaded" });

    await expect(page.locator("main")).toBeVisible();
  });

  test("editor can view quality validation page", async ({ page }) => {
    await loginViaUi(page, "editor");
    await page.goto("/quality/validation", { waitUntil: "domcontentloaded" });

    await expect(page.locator("main")).toBeVisible();
  });

  test("editor can view quality issues inbox", async ({ page }) => {
    await loginViaUi(page, "editor");
    await page.goto("/quality/issues", { waitUntil: "domcontentloaded" });

    await expect(page.locator("main")).toBeVisible();
  });

  test("channel_manager can check channel readiness", async ({ page }) => {
    await loginViaUi(page, "channel_manager");
    await page.goto("/channels", { waitUntil: "domcontentloaded" });

    await expect(page.locator("main")).toBeVisible();
    // Should see channel overview with connectors or empty state
    await expect(
      page.locator('[class*="card"], [class*="channel"], table, [class*="empty"]').first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test("viewer cannot access bulk edit (API enforcement)", async () => {
    const viewerToken = await apiLogin("viewer");
    try {
      await require("./helpers/vexa-pim.cjs").apiRequest(
        "GET", "/bulk-edit/operations?limit=5", viewerToken,
      );
      expect(true).toBe(false);
    } catch (err) {
      expect(err.message).toMatch(/403|forbidden/i);
    }
  });
});
