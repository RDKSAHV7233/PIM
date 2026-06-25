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

async function apiRequestRaw(method, route, token, body, extraHeaders = {}) {
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
  return { status: response.status, ok: response.ok, payload };
}

async function apiRequestWithHeaders(method, route, token, body, extraHeaders = {}) {
  const result = await apiRequestRaw(method, route, token, body, extraHeaders);
  if (!result.ok) {
    throw new Error(`${method} ${route} → ${result.status}: ${JSON.stringify(result.payload)}`);
  }
  return result.payload;
}

async function issueStepUpToken(token) {
  const res = await apiRequestWithHeaders("POST", "/auth/step-up", token, {
    password: STEP_UP_PASSWORD,
    scope: "mapping_high_risk",
  });
  return String(res.stepUpToken ?? "").trim();
}

function buildShopifyMappingsUrl(categoryId, extra = {}) {
  const params = new URLSearchParams({ channel: "shopify", categoryId, ...extra });
  return `/channels/mappings?${params.toString()}`;
}

test("account mismatch: draft for Shopify-A cannot be published as Shopify-B; publish succeeds with correct installation", async ({
  page,
}) => {
  const adminToken = await apiLogin("admin");

  const definitionsRaw = await apiRequest("GET", "/connectors/definitions", adminToken);
  const definitions = Array.isArray(definitionsRaw) ? definitionsRaw : (definitionsRaw?.items ?? []);
  test.skip(
    !definitions.find((d) => d.slug === "shopify"),
    "shopify connector not configured in this environment",
  );

  const aliasA = uniqueName("sp-acct-a").toLowerCase().slice(0, 32);
  const aliasB = uniqueName("sp-acct-b").toLowerCase().slice(0, 32);
  let installationA = null;
  let installationB = null;
  let versionId = null;
  let category = null;
  let product = null;

  try {
    installationA = await apiRequest("POST", "/connectors/shopify/install", adminToken, {
      accountAlias: aliasA,
      shopDomain: SHOP_DOMAIN,
    });
    installationB = await apiRequest("POST", "/connectors/shopify/install", adminToken, {
      accountAlias: aliasB,
      shopDomain: SHOP_DOMAIN,
    });
    expect(String(installationA.id).length).toBeGreaterThan(5);
    expect(String(installationB.id).length).toBeGreaterThan(5);
    expect(installationA.id).not.toBe(installationB.id);

    category = await createCategory(adminToken, uniqueName("sp-mismatch-cat"));
    product = await createProduct(adminToken, {
      title: uniqueName("sp-mismatch-product"),
      brand: "Vexa PIM",
      description: "shopify account mismatch e2e scenario",
      sku: uniqueName("sku").toLowerCase(),
      categoryId: category.id,
      status: "draft",
    });

    // Draft scoped to installation A
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
        installationId: String(installationA.id),
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
    expect(draft.draftInstallationId).toBe(String(installationA.id));

    // Validate the draft
    await apiRequest(
      "POST",
      `/marketplace/connectors/shopify/mappings/versions/${encodeURIComponent(versionId)}/validate`,
      adminToken,
    );

    // --- UI: navigate with installation B selected → mismatch warning must be visible ---
    await loginViaUi(page, "admin");
    await page.goto(
      buildShopifyMappingsUrl(category.id, {
        installationId: String(installationB.id),
        showContext: "1",
        showHistory: "1",
      }),
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.getByRole("heading", { name: /Context/i }).first()).toBeVisible();
    await expect(page.getByText("Account mismatch")).toBeVisible();

    // --- API: publish with installation B must be rejected (409) ---
    const stepUpToken1 = await issueStepUpToken(adminToken);
    const mismatchResult = await apiRequestRaw(
      "POST",
      `/marketplace/connectors/shopify/mappings/versions/${encodeURIComponent(versionId)}/publish`,
      adminToken,
      { confirm: true, installationId: String(installationB.id) },
      { [STEP_UP_HEADER]: stepUpToken1 },
    );
    expect(mismatchResult.status).toBe(409);
    const mismatchMessage = String(
      mismatchResult.payload?.message ?? mismatchResult.payload?.error ?? mismatchResult.payload ?? "",
    );
    expect(mismatchMessage).toContain("account_mismatch_draft_vs_publish");

    // --- API: omitting installationId while draft is scoped must also be rejected ---
    const stepUpToken2 = await issueStepUpToken(adminToken);
    const bypassResult = await apiRequestRaw(
      "POST",
      `/marketplace/connectors/shopify/mappings/versions/${encodeURIComponent(versionId)}/publish`,
      adminToken,
      { confirm: true },
      { [STEP_UP_HEADER]: stepUpToken2 },
    );
    expect(bypassResult.status).toBe(409);
    expect(String(bypassResult.payload?.message ?? bypassResult.payload?.error ?? "")).toContain(
      "account_mismatch_draft_vs_publish",
    );

    // --- API: publish with the correct installation A must succeed ---
    const stepUpToken3 = await issueStepUpToken(adminToken);
    await apiRequestWithHeaders(
      "POST",
      `/marketplace/connectors/shopify/mappings/versions/${encodeURIComponent(versionId)}/publish`,
      adminToken,
      { confirm: true, installationId: String(installationA.id) },
      { [STEP_UP_HEADER]: stepUpToken3 },
    );

    await expect.poll(
      async () => {
        const versions = await apiRequest(
          "GET",
          `/marketplace/connectors/shopify/mappings/versions?categoryScope=${encodeURIComponent(category.id)}&includeArchived=true`,
          adminToken,
        );
        const v = Array.isArray(versions) ? versions.find((ver) => String(ver.id) === versionId) : null;
        return v?.lifecycleState ?? "";
      },
      { timeout: 30000 },
    ).toBe("published");
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
    if (installationA) {
      try { await apiRequest("POST", `/connectors/${installationA.id}/uninstall`, adminToken, {}); } catch {}
      try { await apiRequest("DELETE", `/connectors/shopify/install/${installationA.id}`, adminToken); } catch {}
    }
    if (installationB) {
      try { await apiRequest("POST", `/connectors/${installationB.id}/uninstall`, adminToken, {}); } catch {}
      try { await apiRequest("DELETE", `/connectors/shopify/install/${installationB.id}`, adminToken); } catch {}
    }
  }
});
