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

function buildMappingsUrl(categoryId, productId, extra = {}) {
  const params = new URLSearchParams({
    step: "scope",
    channel: "flipkart",
    categoryId,
    productId,
    ...extra,
  });
  return `/channels/mappings?${params.toString()}`;
}

async function listVersions(token, categoryId) {
  return apiRequest(
    "GET",
    `/marketplace/connectors/flipkart/mappings/versions?categoryScope=${encodeURIComponent(categoryId)}&includeArchived=true`,
    token,
  );
}

async function apiRequestWithHeaders(method, route, token, body, extraHeaders = {}, apiUrl = DEFAULT_API_URL) {
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

async function publishViaApi(token, versionId) {
  const stepUpToken = await issueStepUpToken(token);
  return apiRequestWithHeaders(
    "POST",
    `/marketplace/connectors/flipkart/mappings/versions/${encodeURIComponent(versionId)}/publish`,
    token,
    { confirm: true },
    { [STEP_UP_HEADER]: stepUpToken },
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

test("admin can restore a superseded mapping version as a new published version via Rollback", async ({ page }) => {
  const adminToken = await apiLogin("admin");
  const category = await createCategory(adminToken, uniqueName("mapping-rollback-cat"));
  const product = await createProduct(adminToken, {
    title: uniqueName("mapping-rollback-product"),
    brand: "Vexa PIM",
    description: "browser mapping rollback flow",
    categoryId: category.id,
    status: "draft",
    hsnCode: "62046200",
    gstRate: 12,
    attributes: { color: "black", size: "M" },
  });
  const targetCategoryValue = uniqueName("flipkart-rollback-target").toLowerCase();

  let v1Id = null;
  let v2Id = null;
  let currentPublishedId = null;

  try {
    // Establish the precondition entirely via API (create/validate/publish are already
    // covered by the browser journey in channels-mapping-publish.spec.js) — this test's
    // job is to exercise Rollback itself through the real browser UI.
    const v1Draft = await apiRequest(
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
          field_mappings: {
            title: "legacy_title",
            brand: "brand",
            description: "description",
            hsnCode: "hsnCode",
            gstRate: "gstRate",
          },
          category: { source: String(category.id), target: targetCategoryValue },
        },
        fallbackPolicy: { enabled: false },
        fallbackAckRequired: false,
      },
    );
    v1Id = String(v1Draft.id);
    await apiRequest(
      "POST",
      `/marketplace/connectors/flipkart/mappings/versions/${encodeURIComponent(v1Id)}/validate`,
      adminToken,
      {},
    );
    await publishViaApi(adminToken, v1Id);

    const v2Draft = await apiRequest(
      "POST",
      "/marketplace/connectors/flipkart/mappings/versions",
      adminToken,
      {
        categoryScope: String(category.id),
        mappingLevel: "tenant_connector_category_mapping",
        connectorDefinitionId: "flipkart",
        connectorDefinitionVersion: "1.0.1",
        compatibilityState: "compatible",
        mappingRules: {
          field_mappings: {
            title: "current_title",
            brand: "brand",
            description: "description",
            hsnCode: "hsnCode",
            gstRate: "gstRate",
          },
          category: { source: String(category.id), target: targetCategoryValue },
        },
        fallbackPolicy: { enabled: false },
        fallbackAckRequired: false,
      },
    );
    v2Id = String(v2Draft.id);
    await apiRequest(
      "POST",
      `/marketplace/connectors/flipkart/mappings/versions/${encodeURIComponent(v2Id)}/validate`,
      adminToken,
      {},
    );
    await publishViaApi(adminToken, v2Id);

    // Precondition check: v1 is now superseded by v2, v2 is the sole published version.
    await expect.poll(async () => {
      const versions = await listVersions(adminToken, category.id);
      const source = Array.isArray(versions) ? versions.find((v) => String(v.id) === v1Id) : null;
      return source?.lifecycleState ?? "";
    }, { timeout: 30000 }).toBe("superseded");

    // Drive the actual Rollback action through the real browser UI.
    await loginViaUi(page, "admin");
    await page.goto(
      buildMappingsUrl(category.id, product.id, { step: "review", publishCategoryId: targetCategoryValue }),
      { waitUntil: "domcontentloaded" },
    );
    await expect(page.getByText("Step 3: Validate and publish")).toBeVisible();

    const supersededRow = page.locator("tbody tr", { hasText: v1Id }).first();
    await expect(supersededRow).toBeVisible();
    await expect(supersededRow.getByText("Replaced").last()).toBeVisible();

    const rollbackSummary = supersededRow.locator("summary").filter({ hasText: "Rollback" });
    await expect(rollbackSummary).toBeVisible();
    await rollbackSummary.click();

    const rollbackPanel = supersededRow.locator("details[open]").first();
    await expect(rollbackPanel.getByLabel("Rollback reason")).toHaveValue("restore_prior_known_good_mapping");
    await rollbackPanel.getByLabel("Step-up re-authentication").fill(STEP_UP_PASSWORD);
    await submitContainingForm(rollbackPanel.getByRole("button", { name: "Rollback" }));

    // Verify server-side effect: a brand-new version was created and published,
    // v1 remains historical (never itself re-published), v2 is now superseded by the new one.
    // Poll specifically for a published version that is neither v1 nor v2 — v2 is already
    // published before the click, so a poll that merely checks "some published version
    // exists" would resolve instantly against pre-rollback state instead of waiting for
    // the rollback's async server action to actually complete.
    await expect.poll(async () => {
      const versions = await listVersions(adminToken, category.id);
      const published = Array.isArray(versions) ? versions.filter((v) => v.lifecycleState === "published") : [];
      const rollbackVersion = published.find((v) => v.id !== v1Id && v.id !== v2Id);
      return rollbackVersion?.id ?? "";
    }, { timeout: 30000 }).not.toBe("");

    const versionsAfterRollback = await listVersions(adminToken, category.id);
    const publishedAfterRollback = versionsAfterRollback.filter((v) => v.lifecycleState === "published");
    expect(publishedAfterRollback.length).toBe(1);
    currentPublishedId = String(publishedAfterRollback[0].id);
    expect(currentPublishedId).not.toBe(v1Id);
    expect(currentPublishedId).not.toBe(v2Id);

    // Guard against a duplicate/double-submitted rollback request: exactly one version
    // should carry v1's rollback-source evidence, and it must be the one that's live —
    // not an orphaned duplicate left over from a second submission.
    const rollbackSourcedVersions = versionsAfterRollback.filter(
      (v) => String(v.history?.rollback?.metadata?.rollback_source_version_id ?? "") === v1Id,
    );
    expect(rollbackSourcedVersions.length).toBe(1);
    expect(rollbackSourcedVersions[0].id).toBe(currentPublishedId);

    const v1AfterRollback = versionsAfterRollback.find((v) => v.id === v1Id);
    expect(v1AfterRollback?.lifecycleState).toBe("superseded");
    const v2AfterRollback = versionsAfterRollback.find((v) => v.id === v2Id);
    expect(v2AfterRollback?.lifecycleState).toBe("superseded");
    expect(v2AfterRollback?.supersededBy).toBe(currentPublishedId);

    const resolved = await apiRequest(
      "GET",
      `/marketplace/connectors/flipkart/mappings/resolve?categoryScope=${encodeURIComponent(category.id)}`,
      adminToken,
    );
    expect(resolved.resolvedMapping?.field_mappings?.title).toBe("legacy_title");

    // Verify the browser reflects the new live version and its rollback provenance.
    await page.goto(
      buildMappingsUrl(category.id, product.id, { step: "review", publishCategoryId: targetCategoryValue }),
      { waitUntil: "domcontentloaded" },
    );
    const newPublishedRow = page.locator("tbody tr", { hasText: currentPublishedId }).first();
    await expect(newPublishedRow).toBeVisible();
    await expect(newPublishedRow.getByText("Live").last()).toBeVisible();
    await expect(newPublishedRow.getByText(new RegExp(`Rolled back from ${v1Id.slice(0, 8)}`))).toBeVisible();
  } finally {
    if (currentPublishedId) {
      try {
        const stepUpToken = await issueStepUpToken(adminToken);
        await apiRequestWithHeaders(
          "POST",
          `/marketplace/connectors/flipkart/mappings/versions/${encodeURIComponent(currentPublishedId)}/archive`,
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
