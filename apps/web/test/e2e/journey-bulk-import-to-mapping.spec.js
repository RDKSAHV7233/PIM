/**
 * Journey: Bulk Import → Catalog → Quality → Bulk Edit → Channel Mapping
 *
 * Full UX-driven journey across all 5 operational planes.
 * Browser interactions for all main flows; API only for setup and cleanup.
 * Mirrors the sequential test.describe pattern of journey-product-to-publish.spec.js.
 *
 * Planes:
 *   1. Import  — upload CSV inline (no external file), validate, start job, wait for completion
 *   2. Catalog — filter by category, click into imported product
 *   3. Quality — quality tab renders completeness / issue data
 *   4. Bulk Edit — scoped to imported category (plan-gating handled gracefully)
 *   5. Mapping  — scope → map → review steps load with correct channel and category
 */
const { test, expect } = require("@playwright/test");
const {
  apiLogin,
  apiRequest,
  createCategory,
  deleteCategory,
  deleteProduct,
  purgeProduct,
  loginViaUi,
  uniqueName,
  DEFAULT_API_URL,
} = require("./helpers/vexa-pim.cjs");

// Inline CSV — no external file dependency.
// Omit `status` column: setting status in bulk import is admin-only (RESTRICTED_IMPORT_FIELDS).
// This journey runs as "editor", so the CSV must not include restricted fields.
function buildCsvBuffer(categoryHint) {
  const rows = [
    "title,description,brand,hsnCode,gstRate",
    `E2E Journey Product A ${categoryHint},E2E bulk-import-to-mapping journey,Vexa QA,61091000,18`,
    `E2E Journey Product B ${categoryHint},E2E bulk-import-to-mapping journey,Vexa QA,61091000,18`,
    `E2E Journey Product C ${categoryHint},E2E bulk-import-to-mapping journey,Vexa QA,61091000,18`,
  ];
  return Buffer.from(rows.join("\n"), "utf8");
}

test.describe("Journey: Bulk Import → Catalog → Quality → Bulk Edit → Channel Mapping", () => {
  // 3 minutes: async import job (≤60 s) + page interactions
  test.setTimeout(180_000);

  let adminToken;
  let category;
  let liveConnector = null;

  test.beforeAll(async () => {
    adminToken = await apiLogin("admin");
    category = await createCategory(adminToken, uniqueName("j-bim-cat"));

    // Discover a live connector for the mapping plane — use first found, no hardcoding.
    const defsRaw = await apiRequest("GET", "/connectors/definitions", adminToken);
    const defs = Array.isArray(defsRaw) ? defsRaw : (defsRaw?.items ?? []);
    liveConnector = defs.find((d) => d.launchStage === "live") ?? null;
  });

  test.afterAll(async () => {
    if (!adminToken) return;
    // Bulk-purge all products imported into our test category.
    try {
      const productsRaw = await apiRequest(
        "GET",
        `/catalog/products?categoryId=${encodeURIComponent(category.id)}&limit=50`,
        adminToken,
        undefined,
        DEFAULT_API_URL,
      );
      const products = Array.isArray(productsRaw) ? productsRaw : (productsRaw?.items ?? []);
      for (const p of products) {
        try { await deleteProduct(adminToken, p.id); } catch { /* best-effort */ }
        try { await purgeProduct(adminToken, p.id); } catch { /* best-effort */ }
      }
    } catch { /* best-effort */ }
    if (category) {
      try { await deleteCategory(adminToken, category.id); } catch { /* best-effort */ }
    }
  });

  // ═══════════════════════════════════════════════════════════════
  // PLANE 1 — IMPORT
  // ═══════════════════════════════════════════════════════════════

  test("step 1: editor uploads CSV inline, validates preflight, starts import, and job reaches terminal status", async ({ page }) => {
    await loginViaUi(page, "editor");
    await page.goto("/operations/imports", { waitUntil: "domcontentloaded" });

    // Imports page must show an upload form heading
    await expect(page.getByRole("heading", { name: /import/i }).first()).toBeVisible();

    // ── Select our test category ──────────────────────────────────
    // The form renders a native <select name="categoryId"> populated from the category tree.
    const categorySelect = page.locator('select[name="categoryId"]');
    await expect(categorySelect).toBeVisible({ timeout: 10_000 });
    await categorySelect.selectOption({ value: String(category.id) });

    // ── Upload CSV as an in-memory buffer (no external file) ──────
    await page.locator('input[name="sourceFile"]').setInputFiles({
      name: "e2e-journey.csv",
      mimeType: "text/csv",
      buffer: buildCsvBuffer(category.name),
    });

    // ── Click "Validate import file" ─────────────────────────────
    await page.getByRole("button", { name: /validate import file/i }).click();

    // Wait for the preflight result (success or warning-only — both allow import)
    await expect(
      page.getByText(/preflight passed|preflight warnings|validation summary/i).first(),
    ).toBeVisible({ timeout: 30_000 });

    // ── Start the validated import ────────────────────────────────
    // The "Start validated import" button is only enabled after preflight canImport = true.
    const startBtn = page.getByRole("button", { name: /start validated import/i });
    await expect(startBtn).toBeEnabled({ timeout: 5_000 });
    await startBtn.click();

    // After form submission the server action redirects to /operations/imports?bulkJobId=XXX.
    // Wizard-created jobs have a runId so they are excluded from the plain jobs list table
    // (listJobs() filters runId=null). Poll the API directly instead of the UI table.
    // We start from /operations/imports so waitForURL must check for bulkJobId= specifically
    // (not just the path) or it resolves immediately on the existing URL.
    await page.waitForURL(/bulkJobId=/, { timeout: 30_000 });
    const redirectedUrl = page.url();
    const bulkJobId = new URL(redirectedUrl).searchParams.get("bulkJobId") ?? "";

    let jobDone = false;
    const TERMINAL = new Set(["completed", "dead_letter", "failed"]);
    for (let attempt = 0; attempt < 15 && !jobDone; attempt++) {
      try {
        const job = await apiRequest("GET", `/bulk-import/jobs/${encodeURIComponent(bulkJobId)}`, adminToken, undefined, DEFAULT_API_URL);
        if (job && TERMINAL.has(String(job.status ?? "").toLowerCase())) {
          jobDone = true;
        }
      } catch { /* retry */ }
      if (!jobDone) {
        await page.waitForTimeout(4_000);
      }
    }

    expect(jobDone, "Import job did not reach a terminal status within ~60 s").toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════
  // PLANE 2 — CATALOG
  // ═══════════════════════════════════════════════════════════════

  test("step 2: imported products appear in catalog filtered by category", async ({ page }) => {
    await loginViaUi(page, "editor");
    await page.goto(
      `/catalog/products?categoryId=${encodeURIComponent(category.id)}`,
      { waitUntil: "domcontentloaded" },
    );

    // At least one product card or table row must appear
    await expect(
      page.locator('a[href*="/products/"], [class*="product-card"], table tbody tr').first(),
    ).toBeVisible({ timeout: 20_000 });
  });

  test("step 3: editor opens an imported product and sees its status badge", async ({ page }) => {
    await loginViaUi(page, "editor");
    await page.goto(
      `/catalog/products?categoryId=${encodeURIComponent(category.id)}`,
      { waitUntil: "domcontentloaded" },
    );

    // Click the first product link
    const firstLink = page.locator('a[href*="/products/"]').first();
    await expect(firstLink).toBeVisible({ timeout: 15_000 });
    const href = await firstLink.getAttribute("href");
    await page.goto(href, { waitUntil: "domcontentloaded" });

    // Product detail page renders
    await expect(page.locator("main")).toBeVisible();
    // Status badge visible (draft is the CSV default)
    await expect(
      page.getByText(/draft|active|in_review|approved/i).first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  // ═══════════════════════════════════════════════════════════════
  // PLANE 3 — QUALITY
  // ═══════════════════════════════════════════════════════════════

  test("step 4: quality tab renders completeness or validation content for an imported product", async ({ page }) => {
    await loginViaUi(page, "editor");

    // Discover a product ID via the catalog page
    await page.goto(
      `/catalog/products?categoryId=${encodeURIComponent(category.id)}`,
      { waitUntil: "domcontentloaded" },
    );
    const firstLink = page.locator('a[href*="/products/"]').first();
    await expect(firstLink).toBeVisible({ timeout: 15_000 });
    const href = await firstLink.getAttribute("href");
    const productId = href.match(/\/products\/([\w-]+)/)?.[1];
    expect(productId, "Could not parse product ID from href: " + href).toBeTruthy();

    // Navigate to the quality tab
    await page.goto(`/products/${productId}?tab=quality`, { waitUntil: "domcontentloaded" });

    // Quality tab heading or any quality-related element must be visible
    await expect(page.locator("main")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /quality|validation|completeness/i }).first()
        .or(page.locator('[class*="quality"], [class*="score"], [class*="issue"]').first()),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("step 5: quality tab shows a substantive content element — not a blank panel", async ({ page }) => {
    await loginViaUi(page, "editor");

    await page.goto(
      `/catalog/products?categoryId=${encodeURIComponent(category.id)}`,
      { waitUntil: "domcontentloaded" },
    );
    const firstLink = page.locator('a[href*="/products/"]').first();
    await expect(firstLink).toBeVisible({ timeout: 15_000 });
    const href = await firstLink.getAttribute("href");
    const productId = href.match(/\/products\/([\w-]+)/)?.[1];

    await page.goto(`/products/${productId}?tab=quality`, { waitUntil: "domcontentloaded" });

    // Quality tab always renders a "Compliance Validation" CardTitle (<h2>).
    // That heading is unconditional regardless of product status or role.
    await expect(
      page.getByRole("heading", { name: /compliance validation/i }),
    ).toBeVisible({ timeout: 15_000 });
  });

  // ═══════════════════════════════════════════════════════════════
  // PLANE 4 — BULK EDIT
  // ═══════════════════════════════════════════════════════════════

  test("step 6: bulk edit page loads scoped to imported category (plan upgrade wall is a valid render)", async ({ page }) => {
    await loginViaUi(page, "editor");

    // Navigate with category scope pre-selected via query params (GET form)
    await page.goto(
      `/operations/bulk-edit` +
        `?bulkEditCategoryId=${encodeURIComponent(category.id)}` +
        `&bulkEditPreview=1` +
        `&bulkEditField=status` +
        `&bulkEditOperation=set` +
        `&bulkEditValue=draft`,
      { waitUntil: "domcontentloaded" },
    );

    // Page heading must appear
    await expect(page.getByRole("heading", { name: /bulk edit/i })).toBeVisible({ timeout: 10_000 });

    // Either the edit form + scoped products table OR the plan-upgrade wall.
    // Both are valid for this environment — we just assert the page rendered meaningful content.
    // Card renders as <section>; the non-gated path also has <table> and <form>.
    await expect(
      page.locator('section, table, form').first(),
    ).toBeVisible({ timeout: 10_000 });
  });

  // ═══════════════════════════════════════════════════════════════
  // PLANE 5 — CHANNEL MAPPING
  // ═══════════════════════════════════════════════════════════════

  test("step 7: mapping scope step loads with channel and category pre-selected", async ({ page }) => {
    test.skip(!liveConnector, "no live connector available in this environment — skipping mapping plane");

    await loginViaUi(page, "channel_manager");

    const scopeUrl =
      `/channels/mappings` +
      `?step=scope` +
      `&channel=${encodeURIComponent(liveConnector.slug)}` +
      `&categoryId=${encodeURIComponent(category.id)}`;
    await page.goto(scopeUrl, { waitUntil: "domcontentloaded" });

    await expect(page.locator("main")).toBeVisible();

    // Channel label (connector slug or display name) visible in scope controls
    await expect(
      page
        .getByText(new RegExp(liveConnector.displayName ?? liveConnector.slug, "i"))
        .first()
        .or(page.getByRole("heading", { name: /scope|channel|mapping/i }).first()),
    ).toBeVisible({ timeout: 15_000 });

    // Our category name must appear in the scope selector area
    await expect(page.getByText(new RegExp(category.name, "i")).first()).toBeVisible({ timeout: 10_000 });
  });

  test("step 8: mapping map step renders field rows; review step renders readiness checklist", async ({ page }) => {
    test.skip(!liveConnector, "no live connector available in this environment — skipping mapping plane");

    await loginViaUi(page, "channel_manager");

    // ── Map step ─────────────────────────────────────────────────
    await page.goto(
      `/channels/mappings` +
        `?step=map` +
        `&channel=${encodeURIComponent(liveConnector.slug)}` +
        `&categoryId=${encodeURIComponent(category.id)}`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.locator("main")).toBeVisible();
    // At least one field row visible in the mapping table
    await expect(
      page.locator('[class*="field"], [class*="mapping"], table tbody tr').first(),
    ).toBeVisible({ timeout: 15_000 });

    // ── Review step ───────────────────────────────────────────────
    await page.goto(
      `/channels/mappings` +
        `?step=review` +
        `&channel=${encodeURIComponent(liveConnector.slug)}` +
        `&categoryId=${encodeURIComponent(category.id)}`,
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.locator("main")).toBeVisible();
    // Readiness checklist or review heading present
    await expect(
      page
        .locator('[class*="checklist"], [class*="readiness"], [class*="check"]')
        .first()
        .or(page.getByRole("heading", { name: /review|publish|readiness/i }).first()),
    ).toBeVisible({ timeout: 15_000 });
  });
});
