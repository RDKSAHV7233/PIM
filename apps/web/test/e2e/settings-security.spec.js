/**
 * Settings → Security page E2E
 *
 * Verifies /settings/security renders for authenticated users,
 * shows MFA status and plan tier, and loads for multiple roles.
 */
const { test, expect } = require("@playwright/test");
const { loginViaUi } = require("./helpers/vexa-pim.cjs");

test.describe("/settings/security", () => {
  test("admin: renders MFA status and plan tier", async ({ page }) => {
    await loginViaUi(page, "admin");
    await page.goto("/settings/security", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main")).toBeVisible({ timeout: 15_000 });

    await expect(page.getByText(/multi-factor|mfa/i)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByRole("link", { name: "View plans" })).toBeVisible({ timeout: 10_000 });
  });

  test("viewer: renders security page with limited content", async ({ page }) => {
    await loginViaUi(page, "viewer");
    await page.goto("/settings/security", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main")).toBeVisible({ timeout: 15_000 });
  });
});
