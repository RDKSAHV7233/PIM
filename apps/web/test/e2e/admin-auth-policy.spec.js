/**
 * Admin → Auth Policy + OIDC E2E
 *
 * Verifies /admin/auth-policy and /admin/auth-policy/oidc render
 * for system_admin-gated users and redirect non-admin roles.
 */
const { test, expect } = require("@playwright/test");
const { loginViaUi } = require("./helpers/vexa-pim.cjs");

test.describe("/admin/auth-policy", () => {
  test("admin: auth policy page renders", async ({ page }) => {
    await loginViaUi(page, "admin");
    await page.goto("/admin/auth-policy", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Auth Policy", exact: true })).toBeVisible({ timeout: 10_000 });
  });

  test("admin: OIDC sub-page renders", async ({ page }) => {
    await loginViaUi(page, "admin");
    await page.goto("/admin/auth-policy/oidc", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("heading", { name: /OIDC|SSO/i })).toBeVisible({ timeout: 10_000 });
  });

  test("editor: sees explicit security-admin denial on auth policy", async ({ page }) => {
    await loginViaUi(page, "editor");
    await page.goto("/admin/auth-policy", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Security Admin access required" })).toBeVisible({ timeout: 15_000 });
  });
});
