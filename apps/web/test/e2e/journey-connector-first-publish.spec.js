/**
 * Journey 3: Create → Update → Fix Mapping → Validate → Publish
 *
 * Canonical product-centric browser journey for the shipped Vexa flow:
 *   editor creates draft → editor enriches product → approver approves →
 *   admin fixes + validates + publishes mapping → publisher sees publish outcome
 *
 * This is the highest-signal end-to-end proof that the catalog, mapping,
 * readiness, and publish surfaces still work together as one product flow.
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
  reviewProduct,
  uniqueName,
  updateProduct,
} = require("./helpers/vexa-pim.cjs");

const STEP_UP_HEADER = "x-pim-step-up-token";
const STEP_UP_PASSWORD = process.env.PLAYWRIGHT_PASSWORD || "vexa-pim-demo-password";
const SHOP_DOMAIN = String(
  process.env.PLAYWRIGHT_SHOPIFY_STORE_DOMAIN || "demo-store.myshopify.com",
).trim();

test.setTimeout(180_000);

function buildShopifyMappingsUrl(categoryId, extra = {}) {
  const params = new URLSearchParams({ channel: "shopify", categoryId, ...extra });
  return `/channels/mappings?${params.toString()}`;
}

async function apiRequestWithHeaders(method, route, token, body, extraHeaders = {}) {
  const headers = { Accept: "application/json", ...extraHeaders };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const options = {
    method,
    headers,
    signal: AbortSignal.timeout(20_000),
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${DEFAULT_API_URL}${route}`, options);
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    throw new Error(`${method} ${route} failed: ${response.status}; payload=${JSON.stringify(payload)}`);
  }
  return payload;
}

async function issueStepUpToken(token) {
  const response = await apiRequestWithHeaders("POST", "/auth/step-up", token, {
    password: STEP_UP_PASSWORD,
    scope: "mapping_high_risk",
  });
  return String(response.stepUpToken ?? "").trim();
}

async function listShopifyVersions(token, categoryId) {
  return apiRequest(
    "GET",
    `/marketplace/connectors/shopify/mappings/versions?categoryScope=${encodeURIComponent(categoryId)}&includeArchived=true`,
    token,
  );
}

async function getSubmissionsForProduct(token, productId) {
  const submissions = await apiRequest(
    "GET",
    "/submissions?connectorSlug=shopify&limit=20",
    token,
  );
  const items = Array.isArray(submissions) ? submissions : (submissions?.items ?? []);
  return items.filter(
    (submission) => String(submission.productId ?? submission.product?.id ?? "") === String(productId),
  );
}

async function submitContainingForm(locator) {
  await locator.evaluate((node) => {
    const form = node.closest("form");
    if (!(form instanceof HTMLFormElement)) {
      throw new Error("Expected control to live inside a form.");
    }
    form.requestSubmit();
  });
}

test("product journey flows from draft creation through mapping validation and first publish", async ({ page }) => {
  const adminToken = await apiLogin("admin");
  const editorToken = await apiLogin("editor");
  const approverToken = await apiLogin("approver");

  const definitionsRaw = await apiRequest("GET", "/connectors/definitions", adminToken);
  const definitions = Array.isArray(definitionsRaw) ? definitionsRaw : (definitionsRaw?.items ?? []);
  test.skip(
    !definitions.find((definition) => definition.slug === "shopify"),
    "shopify connector not configured in this environment",
  );

  let installation = null;
  let category = null;
  let product = null;
  let versionId = null;

  try {
    installation = await apiRequest("POST", "/connectors/shopify/install", adminToken, {
      accountAlias: uniqueName("journey-shopify").toLowerCase(),
      shopDomain: SHOP_DOMAIN,
    });

    category = await createCategory(adminToken, uniqueName("journey-catalog-cat"));
    product = await createProduct(editorToken, {
      title: uniqueName("journey-product"),
      brand: "Vexa PIM",
      description: "Canonical end-to-end product journey draft",
      categoryId: category.id,
      status: "draft",
      attributes: {},
    });

    await loginViaUi(page, "editor");
    await page.goto(`/products/${product.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(product.title)).toBeVisible();
    await expect(page.getByText(/draft/i).first()).toBeVisible();

    const firstRevision = await apiRequest("GET", `/catalog/products/${product.id}`, editorToken);
    const journeySku = uniqueName("journey-sku").toLowerCase();
    await updateProduct(editorToken, product.id, {
      expectedVersion: firstRevision.version ?? 1,
      title: firstRevision.title,
      brand: firstRevision.brand,
      description: `${firstRevision.description} Updated with channel-ready content.`,
      categoryId: firstRevision.categoryId,
      sku: journeySku,
      hsnCode: "62046200",
      gstRate: 18,
      attributes: {
        color: "Black",
        size: "M",
      },
      status: "draft",
    });

    const updatedRevision = await apiRequest("GET", `/catalog/products/${product.id}`, editorToken);
    expect(String(updatedRevision.sku ?? "")).toBe(journeySku);
    expect(Number(updatedRevision.gstRate ?? 0)).toBe(18);

    await updateProduct(editorToken, product.id, {
      expectedVersion: updatedRevision.version ?? 2,
      title: updatedRevision.title,
      brand: updatedRevision.brand,
      description: updatedRevision.description,
      categoryId: updatedRevision.categoryId,
      sku: updatedRevision.sku,
      hsnCode: updatedRevision.hsnCode,
      gstRate: updatedRevision.gstRate,
      attributes: updatedRevision.attributes,
      status: "in_review",
    });

    await loginViaUi(page, "approver");
    await page.goto(`/products/${product.id}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText(/in.review|pending.review/i).first()).toBeVisible();

    await reviewProduct(approverToken, product.id, "approved", "Journey approval for mapping and publish");

    await loginViaUi(page, "admin");
    await page.goto(
      buildShopifyMappingsUrl(category.id, {
        step: "scope",
        productId: product.id,
        installationId: String(installation.id),
      }),
      { waitUntil: "domcontentloaded" },
    );

    await expect(page.getByRole("heading", { name: "Channel Mapping" })).toBeVisible();
    await expect(page.getByText(/shopify/i).first()).toBeVisible();

    const installationSelect = page.locator('select[name="installationId"]').first();
    if (await installationSelect.count()) {
      await installationSelect.selectOption(String(installation.id));
    }

    const firstTaxonomyResult = page.getByRole("link", { name: /use this category|selected publish category/i }).first();
    await expect(firstTaxonomyResult).toBeVisible({ timeout: 15_000 });
    const firstTaxonomyHref = await firstTaxonomyResult.getAttribute("href");
    const publishCategoryId = firstTaxonomyHref
      ? new URL(firstTaxonomyHref, "http://127.0.0.1").searchParams.get("publishCategoryId")
      : null;
    expect(String(publishCategoryId ?? "").length).toBeGreaterThan(0);
    await firstTaxonomyResult.click();

    await page.getByRole("link", { name: /continue to required fields/i }).click();
    await expect(page).toHaveURL(/step=map/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: "Step 2: Map Required Fields" })).toBeVisible();

    const coreMappings = [
      ["title", "Title"],
      ["description", "Description"],
      ["brand", "Brand"],
      ["sku", "SKU"],
    ];
    for (const [targetField, sourceField] of coreMappings) {
      const fieldSelect = page.locator(`select[name="mapTarget::${targetField}"]`);
      await expect(fieldSelect).toBeVisible();
      await fieldSelect.selectOption({ label: sourceField });
    }

    const fallbackCategoryField = page.getByLabel("Default fallback category");
    if (await fallbackCategoryField.count()) {
      await fallbackCategoryField.fill(String(publishCategoryId));
    }

    await submitContainingForm(page.getByRole("button", { name: "Save draft version" }));
    await expect(page).toHaveURL(/step=review/, { timeout: 30_000 });
    await expect(page.getByText("Publish Readiness (Hard Gate)")).toBeVisible();

    await expect.poll(async () => {
      const versions = await listShopifyVersions(adminToken, category.id);
      const draftVersion = Array.isArray(versions)
        ? versions.find((candidate) => String(candidate.lifecycleState) === "draft")
        : null;
      versionId = draftVersion?.id ?? versionId;
      return draftVersion?.lifecycleState ?? "";
    }, { timeout: 30_000 }).toBe("draft");

    const draftRow = page.locator("tbody tr", { hasText: versionId }).first();
    await expect(draftRow).toBeVisible();
    await submitContainingForm(draftRow.getByRole("button", { name: "Validate" }));

    await expect.poll(async () => {
      const versions = await listShopifyVersions(adminToken, category.id);
      const version = Array.isArray(versions)
        ? versions.find((candidate) => String(candidate.id) === String(versionId))
        : null;
      return version?.lifecycleState ?? "";
    }, { timeout: 30_000 }).toBe("validated");

    await page.goto(
      buildShopifyMappingsUrl(category.id, {
        step: "review",
        productId: product.id,
        installationId: String(installation.id),
        publishCategoryId: String(publishCategoryId),
        showHistory: "1",
      }),
      { waitUntil: "domcontentloaded" },
    );

    const validatedRow = page.locator("tbody tr", { hasText: versionId }).first();
    await expect(validatedRow).toBeVisible();
    const fallbackAcknowledgement = validatedRow.getByRole("checkbox", { name: /Acknowledge fallback/i });
    if (await fallbackAcknowledgement.count()) {
      await fallbackAcknowledgement.check();
      await submitContainingForm(validatedRow.getByRole("button", { name: "Save acknowledgement" }));
      await expect(page).toHaveURL(/fallbackAcknowledged=true/, { timeout: 30_000 });
      await page.goto(
        buildShopifyMappingsUrl(category.id, {
          step: "review",
          productId: product.id,
          installationId: String(installation.id),
          publishCategoryId: String(publishCategoryId),
          showHistory: "1",
          fallbackAcknowledged: "true",
          fallbackAckVersionId: String(versionId),
        }),
        { waitUntil: "domcontentloaded" },
      );
    }

    const readyToPublishRow = page.locator("tbody tr", { hasText: versionId }).first();
    await expect(readyToPublishRow).toBeVisible();
    await readyToPublishRow.locator("summary").filter({ hasText: "Publish" }).click();
    const publishPanel = readyToPublishRow.locator("details[open]").first();
    await publishPanel.getByLabel("Step-up re-authentication").fill(STEP_UP_PASSWORD);
    await submitContainingForm(publishPanel.getByRole("button", { name: "Publish" }));

    await expect.poll(async () => {
      const versions = await listShopifyVersions(adminToken, category.id);
      const version = Array.isArray(versions)
        ? versions.find((candidate) => String(candidate.id) === String(versionId))
        : null;
      return version?.lifecycleState ?? "";
    }, { timeout: 30_000 }).toBe("published");

    await page.goto(`/products/${product.id}?tab=channels`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Export confirmation")).toBeVisible();
    await expect(page.getByText("Latest export result summary")).toBeVisible();

    const exportJob = await apiRequest(
      "POST",
      `/marketplace/products/${product.id}/export-jobs`,
      adminToken,
      { channel: "shopify", installationId: String(installation.id) },
    );
    expect(exportJob).toBeDefined();

    await expect.poll(
      async () => (await getSubmissionsForProduct(adminToken, product.id)).length,
      { timeout: 30_000, intervals: [3_000] },
    ).toBeGreaterThanOrEqual(1);

    const submissions = await getSubmissionsForProduct(adminToken, product.id);
    expect(["PENDING", "ACTIVE", "PUBLISHED", "ERROR", "REJECTED"]).toContain(submissions[0]?.status);

    await loginViaUi(page, "publisher");
    await page.goto(`/channels/submissions?productId=${encodeURIComponent(product.id)}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.locator("main")).toBeVisible();
    await expect(
      page.locator('table, [class*="grid"], [class*="empty"], [class*="card"]').first(),
    ).toBeVisible({ timeout: 15_000 });
  } finally {
    if (versionId) {
      try {
        const stepUpToken = await issueStepUpToken(adminToken);
        await apiRequestWithHeaders(
          "POST",
          `/marketplace/connectors/shopify/mappings/versions/${encodeURIComponent(versionId)}/archive`,
          adminToken,
          { reason: "playwright_cleanup_archive" },
          { [STEP_UP_HEADER]: stepUpToken },
        );
      } catch {}
    }
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
  }
});
