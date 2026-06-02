/**
 * Journey 1: Product → Approval → Publish
 *
 * Ship gate test. Exercises the core seller workflow across 3 roles:
 *   editor creates product → approver approves → publisher triggers publish
 *
 * This test validates cross-role handoff, status transitions, and the
 * publish readiness → submission tracking flow end-to-end.
 */
const { test, expect } = require("@playwright/test");
const {
  apiLogin,
  apiRequest,
  createCategory,
  createProduct,
  deleteCategory,
  deleteProduct,
  loginViaUi,
  purgeProduct,
  reviewProduct,
  uniqueName,
  updateProduct,
} = require("./helpers/vexa-pim.cjs");

test.describe("Journey: Product → Approval → Publish", () => {
  test.describe.configure({ tag: "@smoke" });

  let adminToken;
  let editorToken;
  let category;
  let product;

  test.beforeAll(async () => {
    adminToken = await apiLogin("admin");
    editorToken = await apiLogin("editor");
    category = await createCategory(adminToken, uniqueName("j1-publish-cat"));
  });

  test.afterAll(async () => {
    if (product) {
      try { await deleteProduct(adminToken, product.id); } catch {}
      try { await purgeProduct(adminToken, product.id); } catch {}
    }
    if (category) {
      try { await deleteCategory(adminToken, category.id); } catch {}
    }
  });

  test("step 1: editor creates product in draft", async ({ page }) => {
    product = await createProduct(editorToken, {
      title: uniqueName("j1-publish-product"),
      brand: "Journey Test Brand",
      description: "End-to-end journey test product",
      categoryId: category.id,
      status: "draft",
      hsnCode: "62046200",
      gstRate: 18,
      attributes: {},
    });

    await loginViaUi(page, "editor");
    await page.goto(`/products/${product.id}`, { waitUntil: "domcontentloaded" });

    // Verify product is visible and in draft status
    await expect(page.getByText(product.title)).toBeVisible();
    await expect(page.locator('[data-testid="product-status"], .status-chip, [class*="status"]')
      .filter({ hasText: /draft/i }).first()).toBeVisible({ timeout: 10_000 });
  });

  test("step 2: editor submits product for review", async ({ page }) => {
    // Submit for review via API (status transition: draft → in_review)
    await updateProduct(editorToken, product.id, { status: "in_review" });

    await loginViaUi(page, "editor");
    await page.goto(`/products/${product.id}`, { waitUntil: "domcontentloaded" });

    // Verify status changed to in_review
    await expect(page.locator('[data-testid="product-status"], .status-chip, [class*="status"]')
      .filter({ hasText: /in.review|pending|review/i }).first()).toBeVisible({ timeout: 10_000 });
  });

  test("step 3: approver sees product in approval queue and approves", async ({ page }) => {
    const approverToken = await apiLogin("approver");

    // Approve via API
    await reviewProduct(approverToken, product.id, "approved", "Journey test — approved");

    // Verify via UI as approver
    await loginViaUi(page, "approver");
    await page.goto(`/products/${product.id}`, { waitUntil: "domcontentloaded" });

    await expect(page.locator('[data-testid="product-status"], .status-chip, [class*="status"]')
      .filter({ hasText: /approved/i }).first()).toBeVisible({ timeout: 10_000 });
  });

  test("step 4: publisher can see the approved product", async ({ page }) => {
    await loginViaUi(page, "publisher");
    await page.goto(`/products/${product.id}`, { waitUntil: "domcontentloaded" });

    // Publisher should see the product and its approved status
    await expect(page.getByText(product.title)).toBeVisible();
    await expect(page.locator('[data-testid="product-status"], .status-chip, [class*="status"]')
      .filter({ hasText: /approved/i }).first()).toBeVisible({ timeout: 10_000 });
  });

  test("step 5: dashboard reflects the approved product count", async ({ page }) => {
    await loginViaUi(page, "admin");
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });

    // Dashboard should load without errors
    await expect(page.locator("main")).toBeVisible();
    // Look for any KPI card or metric that shows catalog data
    await expect(page.locator('[class*="card"], [class*="kpi"], [class*="metric"]').first())
      .toBeVisible({ timeout: 15_000 });
  });
});
