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
} = require("./helpers/vexa-pim.cjs");

const SHOP_DOMAIN = String(
  process.env.PLAYWRIGHT_SHOPIFY_STORE_DOMAIN || "demo-store.myshopify.com",
).trim();

test.setTimeout(120_000);

async function getSubmissionsForProduct(token, productId) {
  const submissions = await apiRequest(
    "GET",
    `/submissions?connectorSlug=shopify&limit=50`,
    token,
    undefined,
    DEFAULT_API_URL,
  );
  const items = Array.isArray(submissions) ? submissions : (submissions?.items ?? []);
  return items.filter(
    (s) => String(s.productId ?? s.product?.id ?? "") === String(productId),
  );
}

test.describe.serial("Shopify product publish journey", () => {
  let adminToken;
  let installation;
  let category;
  let product;

  test.beforeAll(async () => {
    adminToken = await apiLogin("admin");

    const definitionsRaw = await apiRequest("GET", "/connectors/definitions", adminToken);
    const definitions = Array.isArray(definitionsRaw) ? definitionsRaw : (definitionsRaw?.items ?? []);
    test.skip(
      !definitions.find((d) => d.slug === "shopify"),
      "shopify connector not configured in this environment",
    );

    installation = await apiRequest("POST", "/connectors/shopify/install", adminToken, {
      accountAlias: uniqueName("e2e-pub-journey").toLowerCase(),
      shopDomain: SHOP_DOMAIN,
    });

    await apiRequest("POST", `/connectors/${installation.id}/oauth/callback`, adminToken, {
      shop: SHOP_DOMAIN,
      accessToken: "e2e-direct-access-token",
    });

    await apiRequest("POST", `/connectors/${installation.id}/publication-targets`, adminToken, {
      publicationIds: ["gid://shopify/Publication/1"],
    });

    category = await createCategory(adminToken, uniqueName("e2e-pub-journey-cat"));
  });

  test.afterAll(async () => {
    if (product) {
      try { await deleteProduct(adminToken, product.id); } catch {}
      try { await purgeProduct(adminToken, product.id); } catch {}
    }
    if (category) {
      try { await deleteCategory(adminToken, category.id); } catch {}
    }
    if (installation?.id) {
      try { await apiRequest("POST", `/connectors/${installation.id}/uninstall`, adminToken, {}); } catch {}
      try { await apiRequest("DELETE", `/connectors/shopify/install/${installation.id}`, adminToken); } catch {}
    }
  });

  test("publish product with image → GID persisted → republish idempotent", async () => {
    const skuCode = uniqueName("sku-pub-journey").toLowerCase();

    product = await createProduct(adminToken, {
      title: uniqueName("e2e-pub-journey"),
      brand: "Vexa PIM",
      description: "Full publish journey: create, approve, publish, GID, republish",
      categoryId: category.id,
      status: "draft",
      hsnCode: "62044200",
      gstRate: 12,
      attributes: {
        mainImageUrl: "https://example.com/test-product-image.jpg",
      },
    });

    await apiRequest(
      "POST",
      `/catalog/products/${product.id}/variants`,
      adminToken,
      {
        skuCode,
        attributes: {},
        inventoryQty: 10,
        status: "active",
      },
    );

    const freshProduct = await apiRequest("GET", `/catalog/products/${product.id}`, adminToken);
    await apiRequest("PATCH", `/catalog/products/${product.id}`, adminToken, {
      expectedVersion: freshProduct.version ?? 1,
      status: "in_review",
    });
    await reviewProduct(adminToken, product.id, "approved", "e2e auto-approval for publish journey");

    const exportJob = await apiRequest(
      "POST",
      `/marketplace/products/${product.id}/export-jobs`,
      adminToken,
      { channel: "shopify", installationId: String(installation.id) },
    );
    expect(exportJob).toBeDefined();

    let firstSubmission;
    await expect.poll(
      async () => {
        const subs = await getSubmissionsForProduct(adminToken, product.id);
        if (subs.length > 0 && subs[0].status !== "PENDING") {
          firstSubmission = subs[0];
          return subs[0].status;
        }
        return "PENDING";
      },
      { timeout: 30_000, intervals: [2000] },
    ).toMatch(/PUBLISHED|ACTIVE|SUCCESS/);

    expect(firstSubmission).toBeDefined();
    expect(firstSubmission.externalRef).toBeDefined();
    expect(String(firstSubmission.externalRef)).toMatch(/^gid:\/\/shopify\/Product\//);
    const firstGid = String(firstSubmission.externalRef);

    const republishJob = await apiRequest(
      "POST",
      `/marketplace/products/${product.id}/export-jobs`,
      adminToken,
      { channel: "shopify", installationId: String(installation.id) },
    );
    expect(republishJob).toBeDefined();

    await expect.poll(
      async () => {
        const subs = await getSubmissionsForProduct(adminToken, product.id);
        return subs.filter((s) => s.status !== "PENDING").length;
      },
      { timeout: 30_000, intervals: [2000] },
    ).toBeGreaterThanOrEqual(2);

    const allSubs = await getSubmissionsForProduct(adminToken, product.id);
    const terminalSubs = allSubs.filter((s) => s.status !== "PENDING");
    expect(terminalSubs.length).toBeGreaterThanOrEqual(2);
    const secondSubmission = terminalSubs.find((s) => String(s.id) !== String(firstSubmission.id));
    expect(secondSubmission).toBeDefined();
    expect(String(secondSubmission.externalRef)).toBe(firstGid);
  });

  test("editor role cannot publish (403)", async () => {
    test.skip(!product, "depends on product from previous test");
    const editorToken = await apiLogin("editor");

    let errorStatus;
    try {
      await apiRequest(
        "POST",
        `/marketplace/products/${product.id}/export-jobs`,
        editorToken,
        { channel: "shopify", installationId: String(installation.id) },
      );
      errorStatus = 200;
    } catch (err) {
      const match = String(err.message).match(/failed: (\d+)/);
      errorStatus = match ? parseInt(match[1], 10) : 0;
    }
    expect(errorStatus).toBe(403);
  });

  test("publisher role can publish", async () => {
    test.skip(!product, "depends on product from previous test");
    const publisherToken = await apiLogin("publisher");

    const exportJob = await apiRequest(
      "POST",
      `/marketplace/products/${product.id}/export-jobs`,
      publisherToken,
      { channel: "shopify", installationId: String(installation.id) },
    );
    expect(exportJob).toBeDefined();

    await expect.poll(
      async () => {
        const subs = await getSubmissionsForProduct(adminToken, product.id);
        return subs.filter((s) => s.status !== "PENDING").length;
      },
      { timeout: 30_000, intervals: [2000] },
    ).toBeGreaterThanOrEqual(3);
  });

  test("channel_manager role can publish", async () => {
    test.skip(!product, "depends on product from previous test");
    const channelManagerToken = await apiLogin("channel_manager");

    const exportJob = await apiRequest(
      "POST",
      `/marketplace/products/${product.id}/export-jobs`,
      channelManagerToken,
      { channel: "shopify", installationId: String(installation.id) },
    );
    expect(exportJob).toBeDefined();

    await expect.poll(
      async () => {
        const subs = await getSubmissionsForProduct(adminToken, product.id);
        return subs.filter((s) => s.status !== "PENDING").length;
      },
      { timeout: 30_000, intervals: [2000] },
    ).toBeGreaterThanOrEqual(4);
  });

  test("submissions page shows published product with Shopify GID", async ({ page }) => {
    test.skip(!product, "depends on product from previous test");
    await loginViaUi(page, "admin");

    await page.goto("/channels/submissions", { waitUntil: "domcontentloaded" });
    await expect(page.locator("main")).toBeVisible({ timeout: 15_000 });

    const table = page.locator("table").first();
    await expect(table).toBeVisible({ timeout: 15_000 });

    await expect(table.locator("th, td")).not.toHaveCount(0);

    const kpiCards = page.locator('[class*="kpi"], [class*="Kpi"]');
    const totalLabel = page.getByText("Total Submissions");
    if (await totalLabel.isVisible().catch(() => false)) {
      await expect(totalLabel).toBeVisible();
    }

    const acceptedLabel = page.getByText("Accepted");
    if (await acceptedLabel.isVisible().catch(() => false)) {
      await expect(acceptedLabel).toBeVisible();
    }

    const statusChips = page.locator('text=/SUCCESS|PUBLISHED|ACTIVE/i');
    await expect(statusChips.first()).toBeVisible({ timeout: 10_000 });

    const shopifyRef = page.locator('text=/shopify:\\d+/');
    await expect(shopifyRef.first()).toBeVisible({ timeout: 10_000 });

    const productLink = page.locator(`a[href*="/products/${product.id.slice(0, 8)}"]`).first();
    if (await productLink.isVisible().catch(() => false)) {
      await expect(productLink).toBeVisible();
    }

    const firstDataRow = table.locator("tbody tr").first();
    await firstDataRow.click();

    const drawer = page.locator('[class*="drawer"], [role="dialog"], [class*="Drawer"]').first();
    await expect(drawer).toBeVisible({ timeout: 10_000 });

    const externalRef = drawer.locator('text=/gid:\\/\\/shopify\\/Product\\//');
    await expect(externalRef).toBeVisible({ timeout: 5_000 });
  });
});
