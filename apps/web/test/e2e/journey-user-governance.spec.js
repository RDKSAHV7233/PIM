/**
 * Journey 4: User Lifecycle → Governance
 *
 * Ship gate test. Exercises admin governance workflows:
 *   admin views users → audit trail works → API keys work → webhooks work
 *
 * Validates the admin governance surface is functional across all sub-sections.
 */
const { test, expect } = require("@playwright/test");
const {
  apiLogin,
  apiRequest,
  loginViaUi,
  DEFAULT_API_URL,
} = require("./helpers/vexa-pim.cjs");

test.describe("Journey: User Governance", () => {
  test("admin can view user list with role information", async ({ page }) => {
    await loginViaUi(page, "admin");
    await page.goto("/admin/users", { waitUntil: "domcontentloaded" });

    await expect(page.locator("main")).toBeVisible();
    // Should see user rows with role badges
    await expect(
      page.locator("table, [class*='grid'], [class*='user']").first()
    ).toBeVisible({ timeout: 15_000 });
    // At least one user row should show a role
    await expect(
      page.getByText(/admin|editor|viewer|reviewer/i).first()
    ).toBeVisible({ timeout: 10_000 });
  });

  test("admin can view audit logs", async ({ page }) => {
    await loginViaUi(page, "admin");
    await page.goto("/admin/audit", { waitUntil: "domcontentloaded" });

    await expect(page.locator("main")).toBeVisible();
    // Should see audit log entries
    await expect(
      page.locator("table, [class*='grid'], [class*='audit'], [class*='log']").first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test("admin can view plan & usage page", async ({ page }) => {
    await loginViaUi(page, "admin");
    await page.goto("/admin/plan", { waitUntil: "domcontentloaded" });

    await expect(page.locator("main")).toBeVisible();
    // Should show plan tier and usage metrics
    await expect(
      page.getByText(/plan|usage|tier|limit/i).first()
    ).toBeVisible({ timeout: 15_000 });
  });

  test("admin can view API keys page", async ({ page }) => {
    await loginViaUi(page, "admin");
    await page.goto("/admin/api-keys", { waitUntil: "domcontentloaded" });

    await expect(page.locator("main")).toBeVisible();
  });

  test("admin can view webhooks page", async ({ page }) => {
    await loginViaUi(page, "admin");
    await page.goto("/admin/webhooks", { waitUntil: "domcontentloaded" });

    await expect(page.locator("main")).toBeVisible();
  });

  test("editor cannot access admin user management (API)", async () => {
    const editorToken = await apiLogin("editor");
    try {
      await apiRequest("GET", "/admin/workspace/users", editorToken, undefined, DEFAULT_API_URL);
      // Should not reach here — editor is denied
      expect(true).toBe(false);
    } catch (err) {
      expect(err.message).toMatch(/403|forbidden/i);
    }
  });

  test("viewer cannot access admin audit logs (API)", async () => {
    const viewerToken = await apiLogin("viewer");
    try {
      await apiRequest("GET", "/audit/logs?limit=5", viewerToken, undefined, DEFAULT_API_URL);
      expect(true).toBe(false);
    } catch (err) {
      expect(err.message).toMatch(/403|forbidden/i);
    }
  });
});
