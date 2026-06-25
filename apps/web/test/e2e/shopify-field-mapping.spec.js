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
const SHOP_DOMAIN = String(
  process.env.PLAYWRIGHT_SHOPIFY_STORE_DOMAIN || "demo-store.myshopify.com",
).trim();

test.setTimeout(120_000);

function buildShopifyMappingsUrl(categoryId, extra = {}) {
  const params = new URLSearchParams({ channel: "shopify", categoryId, ...extra });
  return `/channels/mappings?${params.toString()}`;
}

async function listShopifyVersions(token, categoryId) {
  return apiRequest(
    "GET",
    `/marketplace/connectors/shopify/mappings/versions?categoryScope=${encodeURIComponent(categoryId)}&includeArchived=true`,
    token,
  );
}

async function apiRequestWithHeaders(method, route, token, body, extraHeaders = {}) {
  const headers = { Accept: "application/json", ...extraHeaders };
  if (token) headers.Authorization = `Bearer ${token}`;
  const options = { method, headers, signal: AbortSignal.timeout(20_000) };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${DEFAULT_API_URL}${route}`, options);
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  if (!response.ok) {
    throw new Error(`${method} ${route} → ${response.status}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function issueStepUpToken(token) {
  const res = await apiRequestWithHeaders("POST", "/auth/step-up", token, {
    password: STEP_UP_PASSWORD,
    scope: "mapping_high_risk",
  });
  return String(res.stepUpToken ?? "").trim();
}

async function submitContainingForm(locator) {
  await locator.evaluate((node) => {
    const form = node.closest("form");
    if (!(form instanceof HTMLFormElement)) throw new Error("No enclosing form found");
    form.requestSubmit();
  });
}

test("admin can create, validate, and publish a Shopify connector mapping version", async ({ page }) => {
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
  let versionId = null;

  try {
    installation = await apiRequest("POST", "/connectors/shopify/install", adminToken, {
      accountAlias: uniqueName("e2e-fmap").toLowerCase(),
      shopDomain: SHOP_DOMAIN,
    });
    expect(String(installation.id).length).toBeGreaterThan(5);

    category = await createCategory(adminToken, uniqueName("shopify-map-cat"));
    product = await createProduct(adminToken, {
      title: uniqueName("shopify-map-product"),
      brand: "Vexa PIM",
      description: "shopify field mapping e2e scenario",
      sku: uniqueName("sku").toLowerCase(),
      categoryId: category.id,
      status: "draft",
    });

    // Create mapping draft bound to the Shopify installation
    const draft = await apiRequest(
      "POST",
      "/marketplace/connectors/shopify/mappings/versions",
      adminToken,
      {
        categoryScope: String(category.id),
        mappingLevel: "tenant_connector_category_mapping",
        connectorDefinitionId: "shopify",
        connectorDefinitionVersion: "1.0.0",
        compatibilityState: "compatible",
        installationId: String(installation.id),
        mappingRules: {
          field_mappings: {
            title: "title",
            description: "description",
          },
        },
        fallbackPolicy: { enabled: false },
        fallbackAckRequired: false,
      },
    );
    versionId = String(draft.id);
    expect(versionId.length).toBeGreaterThan(0);
    expect(draft.lifecycleState).toBe("draft");
    expect(draft.draftInstallationId).toBe(String(installation.id));

    await loginViaUi(page, "admin");
    await page.goto(
      buildShopifyMappingsUrl(category.id, { productId: product.id, showHistory: "1" }),
      { waitUntil: "domcontentloaded" },
    );

    // Mapping page renders for Shopify channel
    await expect(page.getByRole("heading", { name: "Channel Mapping" })).toBeVisible();
    await expect(page.getByText(/shopify/i).first()).toBeVisible();

    const draftRow = page.locator("tbody tr", { hasText: versionId }).first();
    await expect(draftRow).toBeVisible();

    // Validate the draft
    await submitContainingForm(draftRow.getByRole("button", { name: "Validate" }));
    await expect.poll(
      async () => {
        const versions = await listShopifyVersions(adminToken, category.id);
        const v = Array.isArray(versions)
          ? versions.find((ver) => String(ver.id) === versionId)
          : null;
        return v?.lifecycleState ?? "";
      },
      { timeout: 30000 },
    ).toBe("validated");

    // Reload for publish
    await page.goto(
      buildShopifyMappingsUrl(category.id, { productId: product.id, showHistory: "1" }),
      { waitUntil: "domcontentloaded" },
    );
    const validatedRow = page.locator("tbody tr", { hasText: versionId }).first();
    await expect(validatedRow).toBeVisible();

    // Handle optional fallback acknowledgement gate
    const fallbackAck = validatedRow.getByRole("checkbox", { name: /Acknowledge fallback/i });
    if (await fallbackAck.count()) {
      await fallbackAck.check();
      await Promise.all([
        page.waitForURL(/fallbackAcknowledged=true/),
        validatedRow.getByRole("button", { name: "Save acknowledgement" }).click(),
      ]);
      await page.goto(
        buildShopifyMappingsUrl(category.id, {
          productId: product.id,
          showHistory: "1",
          fallbackAcknowledged: "true",
          fallbackAckVersionId: versionId,
        }),
        { waitUntil: "domcontentloaded" },
      );
    }

    const readyRow = page.locator("tbody tr", { hasText: versionId }).first();
    await expect(readyRow).toBeVisible();
    await readyRow.locator("summary").filter({ hasText: "Publish" }).click();
    const publishPanel = readyRow.locator("details[open]").first();
    await publishPanel.getByLabel("Step-up re-authentication").fill(STEP_UP_PASSWORD);
    await submitContainingForm(publishPanel.getByRole("button", { name: "Publish" }));

    await expect.poll(
      async () => {
        const versions = await listShopifyVersions(adminToken, category.id);
        const v = Array.isArray(versions)
          ? versions.find((ver) => String(ver.id) === versionId)
          : null;
        return v?.lifecycleState ?? "";
      },
      { timeout: 30000 },
    ).toBe("published");

    // Published row shows Live badge
    await page.goto(
      buildShopifyMappingsUrl(category.id, { productId: product.id, showHistory: "1" }),
      { waitUntil: "domcontentloaded" },
    );
    const publishedRow = page.locator("tbody tr", { hasText: versionId }).first();
    await expect(publishedRow).toBeVisible();
    await expect(publishedRow.getByText("Live").last()).toBeVisible();
  } finally {
    if (versionId) {
      try {
        const tok = await issueStepUpToken(adminToken);
        await apiRequestWithHeaders(
          "POST",
          `/marketplace/connectors/shopify/mappings/versions/${encodeURIComponent(versionId)}/archive`,
          adminToken,
          { reason: "playwright_cleanup_archive" },
          { [STEP_UP_HEADER]: tok },
        );
      } catch {}
    }
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
