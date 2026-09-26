/**
 * RBAC Boundary Role Enforcement
 *
 * Validates that system_admin_gated pages deny non-system-admin users.
 * These pages require both actorRole === "admin" AND the system_admin
 * (or super_admin) boundary role. Non-admin roles and admin users without
 * the boundary role should see an explicit denial card instead of controls.
 */
const { test, expect } = require("@playwright/test");
const { loginViaUi } = require("./helpers/vexa-pim.cjs");

const SYSTEM_ADMIN_GATED_PAGES = [
  "/admin/api-keys",
  "/admin/webhooks",
  "/admin/audit",
  "/admin/auth-policy",
  "/admin/oidc",
];

const NON_ADMIN_ROLES = [
  "editor",
  "viewer",
  "connector_admin",
  "reviewer",
];

test.describe("system_admin_gated page access", () => {
  for (const role of NON_ADMIN_ROLES) {
    test(`${role}: denied from all system_admin_gated pages`, async ({ page }) => {
      await loginViaUi(page, role);
      for (const url of SYSTEM_ADMIN_GATED_PAGES) {
        await page.goto(url, { waitUntil: "domcontentloaded" });
        await expect(page.getByRole("heading", { name: "Security Admin access required" })).toBeVisible({ timeout: 15_000 });
      }
    });
  }
});
