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
  uniqueName,
} = require("./helpers/vexa-pim.cjs");

// Regression coverage for a reported P0: `/channels/mappings` allegedly threw
// React #418 / "Cannot read properties of null (reading 'parentNode')" in the
// browser. The prime suspect is the nested uncontrolled <details>/<summary>
// structure in AdvancedDrawer (apps/web/src/app/channels/mappings/page.tsx) —
// an outer "Advanced tools" <details> containing up to four more <details>
// panels. Uncontrolled disclosure widgets that React doesn't own can drift
// from React's fiber tree and throw exactly this class of error on
// reconciliation. This spec exercises the states most likely to hit that
// code path: a populated mapping-version history table plus every
// AdvancedDrawer panel open at once, across a fresh load, a hard refresh,
// and a client-side navigation into the page.

const HYDRATION_OR_DOM_ERROR =
  /(react #418|minified react error #418|hydration|parentnode|server rendered html|did not match|cannot read properties of null)/i;

function watchPageRuntimeErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => {
    errors.push(`pageerror: ${error.stack || error.message || String(error)}`);
  });
  page.on("console", (message) => {
    if (!["error", "warning"].includes(message.type())) return;
    const text = message.text();
    if (HYDRATION_OR_DOM_ERROR.test(text)) {
      errors.push(`console ${message.type()}: ${text}`);
    }
  });
  return () => expect(errors, "no hydration/runtime errors on the page").toEqual([]);
}

function buildMappingsUrl(categoryId, productId, extra = {}) {
  const params = new URLSearchParams({
    step: "review",
    channel: "flipkart",
    categoryId,
    productId,
    showHistory: "1",
    showAdvanced: "true",
    ...extra,
  });
  return `/channels/mappings?${params.toString()}`;
}

test.describe("channels mappings hydration regression", () => {
  test("direct load with populated history + all advanced panels renders without runtime errors", async ({ page }) => {
    const adminToken = await apiLogin("admin");
    const category = await createCategory(adminToken, uniqueName("mapping-hydration-cat"));
    const product = await createProduct(adminToken, {
      title: uniqueName("mapping-hydration-product"),
      brand: "Vexa PIM",
      description: "hydration regression fixture",
      categoryId: category.id,
      status: "draft",
      hsnCode: "62046200",
      gstRate: 12,
      attributes: { color: "red", size: "S" },
    });

    // Create a real persisted mapping version so the history table + AdvancedDrawer's
    // "Resolved mapping snapshot" panel both render actual data instead of empty states.
    const draft = await apiRequest(
      "POST",
      "/marketplace/connectors/flipkart/mappings/versions",
      adminToken,
      {
        categoryScope: String(category.id),
        mappingLevel: "tenant_connector_category_mapping",
        connectorDefinitionId: "flipkart",
        connectorDefinitionVersion: "1.0.0",
        compatibilityState: "compatible",
        mappingRules: {
          field_mappings: { title: "title", hsnCode: "hsnCode", gstRate: "gstRate" },
          category: { source: String(category.id), target: uniqueName("fk-target").toLowerCase() },
        },
        fallbackPolicy: { enabled: true, default_category: uniqueName("fk-fallback").toLowerCase() },
        fallbackAckRequired: false,
      },
    );

    try {
      await loginViaUi(page, "admin");
      const assertNoRuntimeErrors = watchPageRuntimeErrors(page);

      for (const advancedPanel of ["resolved", "fallback", "json"]) {
        const response = await page.goto(
          buildMappingsUrl(category.id, product.id, { advancedPanel }),
          { waitUntil: "domcontentloaded" },
        );
        expect(response?.status()).toBe(200);
        await expect(page.getByRole("heading", { name: "Channel Mapping" })).toBeVisible();
        const historyRow = page.locator("tbody tr", { hasText: draft.id }).first();
        await expect(historyRow).toBeVisible();
      }

      // Hard refresh on the last-loaded state.
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "Channel Mapping" })).toBeVisible();

      assertNoRuntimeErrors();
    } finally {
      try {
        await deleteProduct(adminToken, product.id);
      } catch {}
      try {
        await purgeProduct(adminToken, product.id);
      } catch {}
      try {
        await deleteCategory(adminToken, category.id);
      } catch {}
    }
  });

  test("client-side navigation from /channels to /channels/mappings renders without runtime errors", async ({ page }) => {
    await loginViaUi(page, "admin");
    const assertNoRuntimeErrors = watchPageRuntimeErrors(page);

    await page.goto("/channels", { waitUntil: "domcontentloaded" });
    await Promise.all([
      page.waitForURL(/\/channels\/mappings/),
      page.getByRole("link", { name: /Open mapping manager|Review mappings/ }).click(),
    ]);
    await expect(page.getByRole("heading", { name: "Channel Mapping" })).toBeVisible();

    assertNoRuntimeErrors();
  });
});
