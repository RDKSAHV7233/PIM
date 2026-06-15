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

const STEP_UP_HEADER = "x-pim-step-up-token";
const STEP_UP_PASSWORD = process.env.PLAYWRIGHT_PASSWORD || "vexa-pim-demo-password";

async function apiRequestWithHeaders(method, route, token, body, extraHeaders = {}, apiUrl = DEFAULT_API_URL) {
  const headers = { Accept: "application/json", ...extraHeaders };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const options = { method, headers, signal: AbortSignal.timeout(20_000) };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${apiUrl}${route}`, options);
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

async function createAndPublishVersion(adminToken, categoryId, targetCategoryValue, options = {}) {
  const {
    compatibilityState = "compatible",
    extraFieldMappings = {},
    stepUpToken,
  } = options;
  const draft = await apiRequest(
    "POST",
    "/marketplace/connectors/flipkart/mappings/versions",
    adminToken,
    {
      categoryScope: String(categoryId),
      mappingLevel: "tenant_connector_category_mapping",
      connectorDefinitionId: "flipkart",
      connectorDefinitionVersion: "1.0.0",
      compatibilityState,
      mappingRules: {
        field_mappings: {
          title: "title",
          hsnCode: "hsnCode",
          gstRate: "gstRate",
          "attributes.size": "attributes.size",
          "attributes.color": "attributes.color",
          ...extraFieldMappings,
        },
        category: { source: String(categoryId), target: targetCategoryValue },
      },
      fallbackPolicy: { enabled: false },
      fallbackAckRequired: false,
    },
  );
  const versionId = String(draft.id);
  await apiRequest(
    "POST",
    `/marketplace/connectors/flipkart/mappings/versions/${encodeURIComponent(versionId)}/validate`,
    adminToken,
  );
  const tok = stepUpToken ?? (await issueStepUpToken(adminToken));
  await apiRequestWithHeaders(
    "POST",
    `/marketplace/connectors/flipkart/mappings/versions/${encodeURIComponent(versionId)}/publish`,
    adminToken,
    { confirm: true },
    { [STEP_UP_HEADER]: tok },
  );
  return versionId;
}

test("multiple simultaneous blockers resolve one at a time before publish clears", async ({ page }) => {
  const adminToken = await apiLogin("admin");
  const category = await createCategory(adminToken, uniqueName("multi-blocker-cat"));
  const product = await createProduct(adminToken, {
    title: uniqueName("multi-blocker-product"),
    brand: "Vexa PIM",
    description: "multi-blocker e2e scenario",
    categoryId: category.id,
    status: "draft",
    hsnCode: "62046200",
    gstRate: 12,
    attributes: { color: "blue", size: "L" },
  });

  await apiRequest(
    "POST",
    `/taxonomy/categories/${encodeURIComponent(String(category.id))}/attributes`,
    adminToken,
    {
      name: "Connector SKU",
      key: "connector_sku",
      dataType: "text",
      required: true,
      appliesTo: "product",
    },
  );

  const targetCategoryValue = uniqueName("fk-multi-target").toLowerCase();
  const publishedVersionIds = [];

  try {
    // Phase 1: Two blockers active — remap_required + required_attribute_mapping_missing
    const v1 = await createAndPublishVersion(adminToken, category.id, targetCategoryValue, {
      compatibilityState: "remap_required",
    });
    publishedVersionIds.push(v1);

    await loginViaUi(page, "admin");
    const mappingsUrl = `/channels/mappings?channel=flipkart&categoryId=${encodeURIComponent(String(category.id))}&productId=${encodeURIComponent(String(product.id))}`;
    await page.goto(mappingsUrl, { waitUntil: "domcontentloaded" });

    const blockerBar = page.getByRole("alert");
    await expect(blockerBar).toBeVisible();
    await expect(blockerBar).toContainText("Mapping remap is required.");
    await expect(blockerBar).toContainText("One or more required attribute mappings are still missing.");
    await expect(blockerBar.locator("p").first()).toContainText("2 blockers");

    // Phase 2: Fix remap_required — publish compatible version (connector_sku still missing)
    const v2 = await createAndPublishVersion(adminToken, category.id, targetCategoryValue, {
      compatibilityState: "compatible",
    });
    publishedVersionIds.push(v2);

    await page.goto(mappingsUrl, { waitUntil: "domcontentloaded" });
    await expect(blockerBar).toBeVisible();
    await expect(blockerBar).not.toContainText("Mapping remap is required.");
    await expect(blockerBar).toContainText("One or more required attribute mappings are still missing.");
    await expect(blockerBar.locator("p").first()).toContainText("1 blocker");

    // Phase 3: Fix required_attribute_mapping_missing — map connector_sku field
    const v3 = await createAndPublishVersion(adminToken, category.id, targetCategoryValue, {
      compatibilityState: "compatible",
      extraFieldMappings: { "attributes.connector_sku": "attributes.connector_sku" },
    });
    publishedVersionIds.push(v3);

    await page.goto(mappingsUrl, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("alert")).not.toBeVisible();
    await expect(page.getByText("Ready to publish")).toBeVisible();
  } finally {
    for (const vId of publishedVersionIds) {
      try {
        const stepUpToken = await issueStepUpToken(adminToken);
        await apiRequestWithHeaders(
          "POST",
          `/marketplace/connectors/flipkart/mappings/versions/${encodeURIComponent(vId)}/archive`,
          adminToken,
          { reason: "playwright_cleanup_archive" },
          { [STEP_UP_HEADER]: stepUpToken },
        );
      } catch {}
    }
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
