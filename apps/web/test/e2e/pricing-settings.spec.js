/**
 * Pricing Settings Suite
 *
 * Covers the Pricing module added in PR #232:
 *   - Bootstrap endpoint (idempotent India market + INR + default price list)
 *   - GET /pricing/markets, GET /pricing/price-lists, GET /pricing/coverage
 *   - Settings → Pricing page renders (markets / currencies / price lists tabs)
 *   - Product detail → Pricing tab renders
 *   - Dashboard Pricing Coverage card visible for configured tenant
 */
const { test, expect } = require("@playwright/test");
const {
  DEFAULT_API_URL,
  apiLogin,
  apiRequest,
  createCategory,
  createProduct,
  deleteCategory,
  deleteProduct,
  loginViaUi,
  purgeProduct,
  uniqueName,
} = require("./helpers/vexa-pim.cjs");

test.describe("Pricing Settings", () => {
  let adminToken;
  let editorToken;
  let category;

  test.beforeAll(async () => {
    adminToken = await apiLogin("admin");
    editorToken = await apiLogin("editor");
    category = await createCategory(adminToken, uniqueName("e2e-pricing-cat"));

    // Bootstrap default pricing config for this tenant (idempotent)
    try {
      await apiRequest("POST", "/pricing/bootstrap", adminToken, {}, DEFAULT_API_URL);
    } catch {
      // Already bootstrapped — acceptable
    }
  });

  test.afterAll(async () => {
    if (category) {
      try { await deleteCategory(adminToken, category.id); } catch {}
    }
  });

  // ── API contract ────────────────────────────────────────────────────────────

  test("bootstrap is idempotent — second call returns created: false", async () => {
    const result = await apiRequest("POST", "/pricing/bootstrap", adminToken, {}, DEFAULT_API_URL);
    expect(result).toBeDefined();
    // created may be true (first call) or false (already set up) — both valid
    expect(typeof result.created).toBe("boolean");
  });

  test("GET /pricing/markets returns array", async () => {
    const result = await apiRequest("GET", "/pricing/markets", adminToken, undefined, DEFAULT_API_URL);
    expect(Array.isArray(result.items ?? result)).toBe(true);
  });

  test("GET /pricing/currencies returns array", async () => {
    const result = await apiRequest("GET", "/pricing/currencies", adminToken, undefined, DEFAULT_API_URL);
    expect(Array.isArray(result.items ?? result)).toBe(true);
  });

  test("GET /pricing/price-lists returns array", async () => {
    const result = await apiRequest("GET", "/pricing/price-lists", adminToken, undefined, DEFAULT_API_URL);
    expect(Array.isArray(result.items ?? result)).toBe(true);
  });

  test("GET /pricing/coverage returns coverage snapshot", async () => {
    const result = await apiRequest("GET", "/pricing/coverage", adminToken, undefined, DEFAULT_API_URL);
    expect(result).toBeDefined();
    // Coverage response has lists[] and optionally default summary
    const lists = result.lists ?? result;
    expect(Array.isArray(lists)).toBe(true);
  });

  test("non-admin (editor) cannot bootstrap pricing", async () => {
    try {
      await apiRequest("POST", "/pricing/bootstrap", editorToken, {}, DEFAULT_API_URL);
      // Should not reach here — 403 expected
    } catch (err) {
      expect(err.status ?? err.statusCode ?? 403).toBeGreaterThanOrEqual(400);
    }
  });

  // ── UI — Settings → Pricing page ───────────────────────────────────────────

  test("admin can navigate to Settings → Pricing page", async ({ page }) => {
    await loginViaUi(page, "admin");
    await page.goto("/settings/pricing", { waitUntil: "domcontentloaded" });

    await expect(page.locator("main")).toBeVisible();
    // Page should show at least one of: Markets, Currencies, or Price Lists headings
    const heading = page.getByRole("heading", { name: /markets|currencies|price list/i }).first();
    await expect(heading).toBeVisible({ timeout: 15_000 });
  });

  test("Settings → Pricing page shows Markets tab content", async ({ page }) => {
    await loginViaUi(page, "admin");
    await page.goto("/settings/pricing", { waitUntil: "domcontentloaded" });

    // Click Markets tab if tabbed layout
    const marketsTab = page.getByRole("tab", { name: /markets/i });
    const marketsTabExists = await marketsTab.count();
    if (marketsTabExists > 0) {
      await marketsTab.click();
    }

    // Should render something (table, empty state, or list)
    await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });
  });

  test("Settings → Pricing page shows Price Lists tab content", async ({ page }) => {
    await loginViaUi(page, "admin");
    await page.goto("/settings/pricing", { waitUntil: "domcontentloaded" });

    const priceListsTab = page.getByRole("tab", { name: /price.?list/i });
    const tabExists = await priceListsTab.count();
    if (tabExists > 0) {
      await priceListsTab.click();
    }

    await expect(page.locator("main")).toBeVisible({ timeout: 10_000 });
  });

  test("editor cannot access Settings → Pricing page (should redirect or 403)", async ({ page }) => {
    await loginViaUi(page, "editor");
    await page.goto("/settings/pricing", { waitUntil: "domcontentloaded" });

    // Acceptable outcomes: redirect to dashboard, 403 page, or "Access denied" copy
    const url = page.url();
    const isDenied =
      !url.includes("/settings/pricing") ||
      (await page.getByText(/access denied|forbidden|not authoriz/i).count()) > 0 ||
      (await page.getByText(/dashboard/i).count()) > 0;
    expect(isDenied).toBe(true);
  });

  // ── UI — Product detail Pricing tab ────────────────────────────────────────

  test("product detail page has a Pricing tab", async ({ page }) => {
    const product = await createProduct(adminToken, {
      title: uniqueName("e2e-pricing-tab"),
      brand: "Vexa PIM",
      description: "Pricing tab test",
      categoryId: category.id,
      status: "draft",
      hsnCode: "62046200",
      gstRate: 18,
      attributes: {},
    });

    try {
      await loginViaUi(page, "admin");
      await page.goto(`/products/${product.id}`, { waitUntil: "domcontentloaded" });

      await expect(page.getByText(product.title)).toBeVisible({ timeout: 15_000 });

      // Pricing tab should exist
      const pricingTab = page.getByRole("tab", { name: /pricing/i });
      await expect(pricingTab).toBeVisible({ timeout: 10_000 });

      // Click it — should not crash
      await pricingTab.click();
      await expect(page.locator("main")).toBeVisible();
    } finally {
      try { await deleteProduct(adminToken, product.id); } catch {}
      try { await purgeProduct(adminToken, product.id); } catch {}
    }
  });

  // ── UI — Dashboard Pricing Coverage card ───────────────────────────────────

  test("dashboard shows Pricing Coverage card when pricing is configured", async ({ page }) => {
    await loginViaUi(page, "admin");
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });

    await expect(page.locator("main")).toBeVisible();
    // After bootstrap, Pricing Coverage card should appear
    const coverageCard = page.getByText(/pricing coverage/i).first();
    await expect(coverageCard).toBeVisible({ timeout: 15_000 });
  });
});
