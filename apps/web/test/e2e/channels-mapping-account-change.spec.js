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

async function apiRequestRaw(method, route, token, body, extraHeaders = {}, apiUrl = DEFAULT_API_URL) {
  const headers = { Accept: "application/json", ...extraHeaders };
  if (token) headers.Authorization = `Bearer ${token}`;
  const options = { method, headers, signal: AbortSignal.timeout(20_000) };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${apiUrl}${route}`, options);
  const text = await response.text();
  let payload = null;
  try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
  return { status: response.status, ok: response.ok, payload };
}

async function apiRequestWithHeaders(method, route, token, body, extraHeaders = {}, apiUrl = DEFAULT_API_URL) {
  const result = await apiRequestRaw(method, route, token, body, extraHeaders, apiUrl);
  if (!result.ok) {
    throw new Error(`${method} ${route} failed: ${result.status}; payload=${JSON.stringify(result.payload)}`);
  }
  return result.payload;
}

async function issueStepUpToken(token) {
  const response = await apiRequestWithHeaders("POST", "/auth/step-up", token, {
    password: STEP_UP_PASSWORD,
    scope: "mapping_high_risk",
  });
  return String(response.stepUpToken ?? "").trim();
}

function buildMappingsUrl(categoryId, extra = {}) {
  const params = new URLSearchParams({ channel: "flipkart", categoryId, ...extra });
  return `/channels/mappings?${params.toString()}`;
}

test("account mismatch: draft created for installation-A cannot be published as installation-B; publish succeeds when accounts match", async ({ page }) => {
  const adminToken = await apiLogin("admin");

  const aliasA = uniqueName("fk-acct-a").toLowerCase().slice(0, 32);
  const aliasB = uniqueName("fk-acct-b").toLowerCase().slice(0, 32);
  let installationA = null;
  let installationB = null;
  let versionId = null;
  let category = null;
  let product = null;

  try {
    // Create two distinct Flipkart installations
    installationA = await apiRequest("POST", "/connectors/flipkart/install", adminToken, { accountAlias: aliasA });
    installationB = await apiRequest("POST", "/connectors/flipkart/install", adminToken, { accountAlias: aliasB });
    expect(String(installationA.id).length).toBeGreaterThan(5);
    expect(String(installationB.id).length).toBeGreaterThan(5);

    category = await createCategory(adminToken, uniqueName("acct-mismatch-cat"));
    product = await createProduct(adminToken, {
      title: uniqueName("acct-mismatch-product"),
      brand: "Vexa PIM",
      description: "account mismatch e2e scenario",
      categoryId: category.id,
      status: "draft",
      hsnCode: "62046200",
      gstRate: 12,
      attributes: { color: "red", size: "S" },
    });

    const targetCategoryValue = uniqueName("fk-mismatch-target").toLowerCase();

    // Create draft bound to installation A
    const draft = await apiRequest("POST", "/marketplace/connectors/flipkart/mappings/versions", adminToken, {
      categoryScope: String(category.id),
      mappingLevel: "tenant_connector_category_mapping",
      connectorDefinitionId: "flipkart",
      connectorDefinitionVersion: "1.0.0",
      compatibilityState: "compatible",
      installationId: String(installationA.id),
      mappingRules: {
        field_mappings: {
          title: "title",
          hsnCode: "hsnCode",
          gstRate: "gstRate",
          "attributes.size": "attributes.size",
          "attributes.color": "attributes.color",
        },
        category: { source: String(category.id), target: targetCategoryValue },
      },
      fallbackPolicy: { enabled: false },
      fallbackAckRequired: false,
    });
    versionId = String(draft.id);
    expect(draft.draftInstallationId).toBe(String(installationA.id));

    // Validate the draft
    await apiRequest("POST", `/marketplace/connectors/flipkart/mappings/versions/${encodeURIComponent(versionId)}/validate`, adminToken);

    // --- UI: navigate with installation B selected, assert mismatch warning visible ---
    await loginViaUi(page, "admin");
    await page.goto(
      buildMappingsUrl(category.id, {
        installationId: String(installationB.id),
        showContext: "1",
        showHistory: "1",
      }),
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.getByRole("heading", { name: /Context/i }).first()).toBeVisible();
    await expect(page.getByText("Account mismatch")).toBeVisible();

    // --- API: publish attempt with installation B must be rejected (409) ---
    const stepUpToken = await issueStepUpToken(adminToken);
    const mismatchResult = await apiRequestRaw(
      "POST",
      `/marketplace/connectors/flipkart/mappings/versions/${encodeURIComponent(versionId)}/publish`,
      adminToken,
      { confirm: true, installationId: String(installationB.id) },
      { [STEP_UP_HEADER]: stepUpToken },
    );
    expect(mismatchResult.status).toBe(409);
    const errorCode = String(
      mismatchResult.payload?.message ?? mismatchResult.payload?.error ?? mismatchResult.payload ?? "",
    );
    expect(errorCode).toContain("account_mismatch_draft_vs_publish");

    // --- API: publish with the correct installation A must succeed ---
    const stepUpToken2 = await issueStepUpToken(adminToken);
    await apiRequestWithHeaders(
      "POST",
      `/marketplace/connectors/flipkart/mappings/versions/${encodeURIComponent(versionId)}/publish`,
      adminToken,
      { confirm: true, installationId: String(installationA.id) },
      { [STEP_UP_HEADER]: stepUpToken2 },
    );

    // Poll until published
    await expect
      .poll(
        async () => {
          const versions = await apiRequest(
            "GET",
            `/marketplace/connectors/flipkart/mappings/versions?categoryScope=${encodeURIComponent(category.id)}&includeArchived=true`,
            adminToken,
          );
          const v = Array.isArray(versions) ? versions.find((ver) => String(ver.id) === versionId) : null;
          return v?.lifecycleState ?? "";
        },
        { timeout: 30000 },
      )
      .toBe("published");
  } finally {
    if (versionId) {
      try {
        const tok = await issueStepUpToken(adminToken);
        await apiRequestWithHeaders(
          "POST",
          `/marketplace/connectors/flipkart/mappings/versions/${encodeURIComponent(versionId)}/archive`,
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
    if (category) {
      try { await deleteCategory(adminToken, category.id); } catch {}
    }
    if (installationA) {
      try { await apiRequest("POST", `/connectors/${installationA.id}/uninstall`, adminToken, {}); } catch {}
      try { await apiRequest("DELETE", `/connectors/flipkart/install/${installationA.id}`, adminToken); } catch {}
    }
    if (installationB) {
      try { await apiRequest("POST", `/connectors/${installationB.id}/uninstall`, adminToken, {}); } catch {}
      try { await apiRequest("DELETE", `/connectors/flipkart/install/${installationB.id}`, adminToken); } catch {}
    }
  }
});
