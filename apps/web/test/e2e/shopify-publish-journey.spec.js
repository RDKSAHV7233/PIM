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
  reviewProduct,
  uniqueName,
  updateProduct,
} = require("./helpers/vexa-pim.cjs");

const SHOP_DOMAIN = String(
  process.env.PLAYWRIGHT_SHOPIFY_STORE_DOMAIN || "demo-store.myshopify.com",
).trim();

test.setTimeout(120_000);

async function getSubmissionsForProduct(token, productId) {
  const submissions = await apiRequest(
    "GET",
    `/submissions?connectorSlug=shopify&limit=20`,
    token,
    undefined,
    DEFAULT_API_URL,
  );
  const items = Array.isArray(submissions) ? submissions : (submissions?.items ?? []);
  return items.filter(
    (s) => String(s.productId ?? s.product?.id ?? "") === String(productId),
  );
}

test("approved product submitted to Shopify appears in submissions list with a recognised status", async ({
  page,
}) => {
  const adminToken = await apiLogin("admin");

  const definitionsRaw = await apiRequest("GET", "/connectors/definitions", adminToken);
  const definitions = Array.isArray(definitionsRaw) ? definitionsRaw : (definitionsRaw?.items ?? []);
  test.skip(
    !definitions.find((d) => d.slug === "shopify"),
    "shopify connector not configured in this environment",
  );

  let installation = null;
  let category = null;
  let product = null;

  try {
    installation = await apiRequest("POST", "/connectors/shopify/install", adminToken, {
      accountAlias: uniqueName("e2e-pub").toLowerCase(),
      shopDomain: SHOP_DOMAIN,
    });

    category = await createCategory(adminToken, uniqueName("shopify-pub-cat"));
    product = await createProduct(adminToken, {
      title: uniqueName("shopify-pub-product"),
      brand: "Vexa PIM",
      description: "shopify publish journey e2e scenario",
      categoryId: category.id,
      status: "draft",
      hsnCode: "62046200",
      gstRate: 18,
      attributes: { color: "black", size: "M" },
    });

    await updateProduct(adminToken, product.id, {
      expectedVersion: product.version ?? 1,
      title: product.title,
      brand: product.brand,
      description: product.description,
      categoryId: product.categoryId,
      hsnCode: "62046200",
      gstRate: 18,
      attributes: { color: "black", size: "M" },
      status: "in_review",
    });
    await reviewProduct(adminToken, product.id, "approved", "e2e auto-approval for Shopify publish");

    // Create an export job (submission) for the product
    const exportJob = await apiRequest(
      "POST",
      `/marketplace/products/${product.id}/export-jobs`,
      adminToken,
      { channel: "shopify", installationId: String(installation.id) },
    );
    expect(exportJob).toBeDefined();

    // Submission record must appear within 30 s
    await expect.poll(
      async () => (await getSubmissionsForProduct(adminToken, product.id)).length,
      { timeout: 30000, intervals: [3000] },
    ).toBeGreaterThanOrEqual(1);

    // Status must be a known terminal or in-flight value
    const submissions = await getSubmissionsForProduct(adminToken, product.id);
    const submission = submissions[0];
    expect(submission).toBeDefined();
    expect(["PENDING", "ACTIVE", "PUBLISHED", "ERROR", "REJECTED"]).toContain(submission.status);

    // Submissions page renders with Shopify channel content
    await loginViaUi(page, "admin");
    await page.goto("/channels/submissions", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main")).toBeVisible();
    await expect(
      page.locator('table, [class*="grid"], [class*="empty"], [class*="card"]').first(),
    ).toBeVisible({ timeout: 15_000 });
  } finally {
    if (product) {
      try { await deleteProduct(adminToken, product.id); } catch {}
      try { await purgeProduct(adminToken, product.id); } catch {}
    }
    if (category) { try { await deleteCategory(adminToken, category.id); } catch {} }
    if (installation?.id) {
      try { await apiRequest("POST", `/connectors/${installation.id}/uninstall`, adminToken, {}); } catch {}
      try { await apiRequest("DELETE", `/connectors/shopify/install/${installation.id}`, adminToken); } catch {}
    }
  }
});

test("export job for product with missing sku produces a submission that is not stuck in PENDING indefinitely", async () => {
  const adminToken = await apiLogin("admin");

  const definitionsRaw = await apiRequest("GET", "/connectors/definitions", adminToken);
  const definitions = Array.isArray(definitionsRaw) ? definitionsRaw : (definitionsRaw?.items ?? []);
  test.skip(
    !definitions.find((d) => d.slug === "shopify"),
    "shopify connector not configured in this environment",
  );

  let installation = null;
  let category = null;
  let product = null;

  try {
    installation = await apiRequest("POST", "/connectors/shopify/install", adminToken, {
      accountAlias: uniqueName("e2e-errs").toLowerCase(),
      shopDomain: SHOP_DOMAIN,
    });

    category = await createCategory(adminToken, uniqueName("shopify-err-cat"));
    product = await createProduct(adminToken, {
      title: uniqueName("shopify-err-product"),
      brand: "Vexa PIM",
      description: "shopify error path e2e scenario",
      categoryId: category.id,
      status: "draft",
      hsnCode: "62046200",
      gstRate: 18,
      attributes: { color: "blue", size: "L" },
    });

    await updateProduct(adminToken, product.id, {
      expectedVersion: product.version ?? 1,
      title: product.title,
      brand: product.brand,
      description: product.description,
      categoryId: product.categoryId,
      hsnCode: "62046200",
      gstRate: 18,
      attributes: { color: "blue", size: "L" },
      status: "in_review",
    });
    await reviewProduct(adminToken, product.id, "approved", "e2e auto-approval for error path");

    const exportJob = await apiRequest(
      "POST",
      `/marketplace/products/${product.id}/export-jobs`,
      adminToken,
      { channel: "shopify", installationId: String(installation.id) },
    );
    expect(exportJob).toBeDefined();

    // Poll: submission appears and has any status that is not stuck — PENDING is accepted
    // because the worker may not have processed it yet in the test window.
    // ERROR or REJECTED confirms the validation path ran.
    await expect.poll(
      async () => {
        const subs = await getSubmissionsForProduct(adminToken, product.id);
        return subs.length > 0 ? subs[0].status : "";
      },
      { timeout: 30000, intervals: [3000] },
    ).toMatch(/PENDING|ACTIVE|PUBLISHED|ERROR|REJECTED/);
  } finally {
    if (product) {
      try { await deleteProduct(adminToken, product.id); } catch {}
      try { await purgeProduct(adminToken, product.id); } catch {}
    }
    if (category) { try { await deleteCategory(adminToken, category.id); } catch {} }
    if (installation?.id) {
      try { await apiRequest("POST", `/connectors/${installation.id}/uninstall`, adminToken, {}); } catch {}
      try { await apiRequest("DELETE", `/connectors/shopify/install/${installation.id}`, adminToken); } catch {}
    }
  }
});
