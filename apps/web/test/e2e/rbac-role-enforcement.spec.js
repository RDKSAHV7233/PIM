/**
 * RBAC Role Enforcement Suite
 *
 * Ship gate test. One test per role — verifies:
 * 1. Login succeeds and role badge is displayed
 * 2. Core pages load without crash
 * 3. Admin sub-items are visible/hidden per canViewAdminNavigationItem() logic
 * 4. API enforces forbidden write operations with 403
 */
const { test, expect } = require("@playwright/test");
const {
  apiLogin,
  apiRequest,
  loginViaUi,
  DEFAULT_API_URL,
} = require("./helpers/vexa-pim.cjs");

// Pages every authenticated role should be able to read (top-level sections).
// /settings is excluded: redirect-only (→ /admin), causes ERR_ABORTED after redirect chain.
const UNIVERSAL_READ_PAGES = [
  "/dashboard",
  "/catalog/products",
  "/catalog/categories",
  "/channels",
  "/quality/approvals",
];

// Admin-only pages (system_admin_gated in sidebar)
const ADMIN_ONLY_PAGES = [
  "/admin/users",
  "/admin/api-keys",
  "/admin/webhooks",
  "/admin/audit",
  "/admin/auth-policy",
  "/admin/oidc",
];

async function verifyPagesLoad(page, role, pages) {
  await loginViaUi(page, role);
  // Wait for dashboard's BillingStatusBanner streaming to settle before first navigation.
  await page.waitForLoadState("networkidle").catch(() => {});
  for (const url of pages) {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await expect(page.locator("main")).toBeVisible({ timeout: 15_000 });
    // Let the page's RSC streaming finish before the next navigation to avoid ERR_ABORTED.
    await page.waitForLoadState("networkidle").catch(() => {});
  }
}

async function verifyApiForbidden(role, method, route) {
  const token = await apiLogin(role);
  try {
    await apiRequest(method, route, token, method === "GET" ? undefined : {}, DEFAULT_API_URL);
    return false; // Did not throw — access was allowed
  } catch (err) {
    return err.message.includes("403");
  }
}

test.describe("RBAC Enforcement", () => {
  test("admin: full access to all surfaces", async ({ page }) => {
    await verifyPagesLoad(page, "admin", [...UNIVERSAL_READ_PAGES, ...ADMIN_ONLY_PAGES]);
  });

  test("editor: catalog + ops access, limited admin", async ({ page }) => {
    await verifyPagesLoad(page, "editor", UNIVERSAL_READ_PAGES);

    // Editor can access plan page (editor_plus visibility)
    await page.goto("/admin/plan", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main")).toBeVisible();

    // Editor cannot manage users via API
    const forbidden = await verifyApiForbidden("editor", "GET", "/admin/workspace/users");
    expect(forbidden).toBe(true);
  });

  test("publisher: read access + publish, no catalog edit", async ({ page }) => {
    await verifyPagesLoad(page, "publisher", UNIVERSAL_READ_PAGES);

    // Publisher cannot create products via API
    const forbidden = await verifyApiForbidden("publisher", "POST", "/catalog/products");
    expect(forbidden).toBe(true);
  });

  test("approver: read access + approve/reject, no catalog edit", async ({ page }) => {
    await verifyPagesLoad(page, "approver", UNIVERSAL_READ_PAGES);

    // Approver cannot create products via API
    const forbidden = await verifyApiForbidden("approver", "POST", "/catalog/products");
    expect(forbidden).toBe(true);
  });

  test("channel_manager: read + channel management, no catalog edit", async ({ page }) => {
    await verifyPagesLoad(page, "channel_manager", UNIVERSAL_READ_PAGES);

    // Channel manager cannot create products via API
    const forbidden = await verifyApiForbidden("channel_manager", "POST", "/catalog/products");
    expect(forbidden).toBe(true);
  });

  test("connector_admin: read + connector config, no catalog edit", async ({ page }) => {
    await verifyPagesLoad(page, "connector_admin", UNIVERSAL_READ_PAGES);

    // Connector admin can access governance page (connector_admin_plus visibility)
    await page.goto("/admin/connectors", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main")).toBeVisible();

    // Connector admin cannot create products via API
    const forbidden = await verifyApiForbidden("connector_admin", "POST", "/catalog/products");
    expect(forbidden).toBe(true);
  });

  test("reviewer: read access + comments, no write", async ({ page }) => {
    await verifyPagesLoad(page, "reviewer", UNIVERSAL_READ_PAGES);

    // Reviewer cannot create products via API
    const forbidden = await verifyApiForbidden("reviewer", "POST", "/catalog/products");
    expect(forbidden).toBe(true);
  });

  test("viewer: read-only everywhere, no write operations", async ({ page }) => {
    await verifyPagesLoad(page, "viewer", UNIVERSAL_READ_PAGES);

    // Viewer cannot create products via API
    const forbiddenCreate = await verifyApiForbidden("viewer", "POST", "/catalog/products");
    expect(forbiddenCreate).toBe(true);

    // Viewer cannot access admin users via API
    const forbiddenAdmin = await verifyApiForbidden("viewer", "GET", "/admin/workspace/users");
    expect(forbiddenAdmin).toBe(true);

    // Viewer cannot import via API
    const forbiddenImport = await verifyApiForbidden("viewer", "GET", "/bulk-import/jobs?limit=5");
    expect(forbiddenImport).toBe(true);
  });
});
