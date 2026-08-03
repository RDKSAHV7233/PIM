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

// Regression for DEF-01: QA found that a genuine first click on "Submit bulk publish" —
// right after navigating to the connector's Sync tab, before any other page interaction —
// could silently fail to open the confirmation dialog, with no console error and no network
// activity. Root cause wasn't fully pinned (see SCRUM_PLAN §3 SPIKE-01), so this test asserts
// the observable contract directly: navigate fresh, click once, dialog must be visible. It must
// use a real Playwright locator click (Playwright's own actionability wait, not a manual delay)
// so it fails again if the race reappears. Do not "fix" a flaky run here by adding retries,
// polling, or a settle delay before the click — that would silently reintroduce the exact bug
// this test exists to catch.
//
// Runs against every connector slug configured in this environment that supports PUBLISH via
// the shared BulkPublishConfirmForm component, since the defect was proven to be connector-
// agnostic (identical failure reproduced on both Shopify and WooCommerce during investigation).
const CONNECTOR_SCENARIOS = [
  {
    slug: "flipkart",
    install: (adminToken, accountAlias) =>
      apiRequest("POST", "/connectors/flipkart/install", adminToken, { accountAlias }),
    uninstall: async (adminToken, installationId) => {
      try {
        await apiRequest("POST", `/connectors/${installationId}/uninstall`, adminToken, {});
      } catch {}
      try {
        await apiRequest("DELETE", `/connectors/flipkart/install/${installationId}`, adminToken);
      } catch {}
    },
  },
  {
    slug: "shopify",
    install: (adminToken, accountAlias) =>
      apiRequest("POST", "/connectors/shopify/install", adminToken, {
        accountAlias,
        shopDomain: String(process.env.PLAYWRIGHT_SHOPIFY_STORE_DOMAIN || "demo-store.myshopify.com").trim(),
      }),
    uninstall: async (adminToken, installationId) => {
      try {
        await apiRequest("POST", `/connectors/${installationId}/uninstall`, adminToken, {});
      } catch {}
      try {
        await apiRequest("DELETE", `/connectors/shopify/install/${installationId}`, adminToken);
      } catch {}
    },
  },
];

for (const scenario of CONNECTOR_SCENARIOS) {
  test(`${scenario.slug}: first click on Submit bulk publish opens the confirmation dialog`, async ({ page }) => {
    const adminToken = await apiLogin("admin");

    const definitionsRaw = await apiRequest("GET", "/connectors/definitions", adminToken);
    const definitions = Array.isArray(definitionsRaw) ? definitionsRaw : (definitionsRaw?.items ?? []);
    test.skip(
      !definitions.find((d) => d.slug === scenario.slug),
      `${scenario.slug} connector not configured in this environment`,
    );

    let installation = null;
    let category = null;
    let product = null;

    try {
      installation = await scenario.install(adminToken, uniqueName(`e2e-bulk-${scenario.slug}`).toLowerCase());

      category = await createCategory(adminToken, uniqueName(`bulk-publish-cat-${scenario.slug}`));
      product = await createProduct(adminToken, {
        title: uniqueName(`bulk-publish-product-${scenario.slug}`),
        brand: "Vexa PIM",
        description: "DEF-01 bulk-publish dialog regression fixture",
        categoryId: category.id,
        status: "draft",
        hsnCode: "62046200",
        gstRate: 18,
        attributes: {},
      });
      await updateProduct(adminToken, product.id, {
        expectedVersion: product.version,
        title: product.title,
        description: product.description,
        brand: product.brand,
        categoryId: product.categoryId,
        hsnCode: product.hsnCode,
        gstRate: product.gstRate,
        attributes: product.attributes,
        status: "in_review",
      });
      await reviewProduct(adminToken, product.id, "approved", "e2e auto-approval for DEF-01 regression");

      await loginViaUi(page, "admin");

      // Fresh navigation straight to the Sync tab — this is the exact scenario the original
      // defect reproduced in: no warm-up interaction, no prior click on this page load.
      await page.goto(`/channels/connectors/${installation.id}?tab=sync`, { waitUntil: "domcontentloaded" });

      const bulkPublishButton = page.getByRole("button", { name: "Submit bulk publish" });
      await expect(bulkPublishButton).toBeVisible();

      // The single, real, first click — must open the dialog every time, not "eventually" or
      // "on retry". No evaluate(), no requestSubmit(), no manual showModal().
      await bulkPublishButton.click();

      await expect(page.getByRole("heading", { name: "Submit bulk publish feed?" })).toBeVisible();
      await expect(page.getByText(/This will submit 1 approved product/)).toBeVisible();

      // Cancel must close it without submitting.
      await page.getByRole("button", { name: "Cancel" }).click();
      await expect(page.getByRole("heading", { name: "Submit bulk publish feed?" })).toBeHidden();

      // Reopen and confirm. This test's scope is DEF-01 — the dialog opening/closing on a real
      // click — not whether the queued job eventually reaches a downstream connector success,
      // which depends on unrelated product-completeness rules the minimal fixture above doesn't
      // satisfy. Assert only that the confirm action submits and the dialog closes.
      await bulkPublishButton.click();
      await expect(page.getByRole("heading", { name: "Submit bulk publish feed?" })).toBeVisible();
      await page.getByRole("button", { name: "Submit publish" }).click();
      await expect(page.getByRole("heading", { name: "Submit bulk publish feed?" })).toBeHidden();
    } finally {
      if (installation?.id) {
        await scenario.uninstall(adminToken, installation.id);
      }
      if (product) {
        try {
          await deleteProduct(adminToken, product.id);
        } catch {}
        try {
          await purgeProduct(adminToken, product.id);
        } catch {}
      }
      if (category) {
        try {
          await deleteCategory(adminToken, category.id);
        } catch {}
      }
    }
  });
}
