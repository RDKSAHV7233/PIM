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

async function submitContainingForm(locator) {
  await locator.evaluate((node) => {
    const form = node.closest("form");
    if (!(form instanceof HTMLFormElement)) {
      throw new Error("Expected control to live inside a form.");
    }
    form.requestSubmit();
  });
}

const FALLBACK_SCENARIOS = [
  {
    name: "ack required: publish blocked until fallback is acknowledged",
    fallbackEnabled: true,
    ackRequired: true,
    shouldBlock: true,
  },
  {
    name: "fallback without ack requirement: direct publish succeeds",
    fallbackEnabled: true,
    ackRequired: false,
    shouldBlock: false,
  },
  {
    name: "no fallback configured: direct publish succeeds",
    fallbackEnabled: false,
    ackRequired: false,
    shouldBlock: false,
  },
];

test.describe("fallback acknowledgement scenarios", () => {
  for (const scenario of FALLBACK_SCENARIOS) {
    test(scenario.name, async ({ page }) => {
      const adminToken = await apiLogin("admin");
      const category = await createCategory(adminToken, uniqueName("fallback-ack-cat"));
      const product = await createProduct(adminToken, {
        title: uniqueName("fallback-ack-product"),
        brand: "Vexa PIM",
        description: "fallback ack e2e scenario",
        categoryId: category.id,
        status: "draft",
        hsnCode: "62046200",
        gstRate: 12,
        attributes: { color: "blue", size: "L" },
      });
      const targetCategoryValue = uniqueName("fk-target").toLowerCase();
      let versionId = null;

      try {
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
              field_mappings: {
                title: "title",
                hsnCode: "hsnCode",
                gstRate: "gstRate",
                "attributes.size": "attributes.size",
                "attributes.color": "attributes.color",
              },
              category: { source: String(category.id), target: targetCategoryValue },
            },
            fallbackPolicy: scenario.fallbackEnabled
              ? { enabled: true, default_category: uniqueName("fk-fallback").toLowerCase() }
              : { enabled: false },
            fallbackAckRequired: scenario.ackRequired,
          },
        );
        versionId = String(draft.id);

        await loginViaUi(page, "admin");
        await page.goto(buildMappingsUrl(category.id, product.id, { step: "review", publishCategoryId: targetCategoryValue, showHistory: "1" }), {
          waitUntil: "domcontentloaded",
        });

        const draftRow = page.locator("tbody tr", { hasText: versionId }).first();
        await expect(draftRow).toBeVisible();
        await submitContainingForm(draftRow.getByRole("button", { name: "Validate" }));

        await expect.poll(
          async () => {
            const versions = await listVersions(adminToken, category.id);
            const version = Array.isArray(versions)
              ? versions.find((v) => String(v.id) === String(versionId))
              : null;
            return version?.lifecycleState ?? "";
          },
          { timeout: 30000, intervals: [1000] },
        ).toBe("validated");

        await page.goto(buildMappingsUrl(category.id, product.id, { step: "review", publishCategoryId: targetCategoryValue, showHistory: "1" }), {
          waitUntil: "domcontentloaded",
        });
        const validatedRow = page.locator("tbody tr", { hasText: versionId }).first();
        await expect(validatedRow).toBeVisible();

        const fallbackAckCheckbox = validatedRow.getByRole("checkbox", { name: /Acknowledge fallback/i });

        if (scenario.shouldBlock) {
          await expect(fallbackAckCheckbox).toBeVisible();
          await fallbackAckCheckbox.check();
          await Promise.all([
            page.waitForURL(/fallbackAcknowledged=true/),
            validatedRow.getByRole("button", { name: "Save acknowledgement" }).click(),
          ]);
          await page.goto(
            buildMappingsUrl(category.id, product.id, {
              step: "review",
              publishCategoryId: targetCategoryValue,
              showHistory: "1",
              fallbackAcknowledged: "true",
              fallbackAckVersionId: versionId,
            }),
            { waitUntil: "domcontentloaded" },
          );
        } else {
          await expect(fallbackAckCheckbox).toHaveCount(0);
        }

        const readyRow = page.locator("tbody tr", { hasText: versionId }).first();
        await expect(readyRow).toBeVisible();
        await readyRow.locator("summary").filter({ hasText: "Publish" }).click();
        const publishPanel = readyRow.locator("details[open]").first();
        await publishPanel.getByLabel("Step-up re-authentication").fill(STEP_UP_PASSWORD);
        await submitContainingForm(publishPanel.getByRole("button", { name: "Publish" }));

        await expect.poll(
          async () => {
            const versions = await listVersions(adminToken, category.id);
            const version = Array.isArray(versions)
              ? versions.find((v) => String(v.id) === String(versionId))
              : null;
            return version?.lifecycleState ?? "";
          },
          { timeout: 30000, intervals: [1000] },
        ).toBe("published");
      } finally {
        if (versionId) {
          try {
            const stepUpToken = await issueStepUpToken(adminToken);
            await apiRequestWithHeaders(
              "POST",
              `/marketplace/connectors/flipkart/mappings/versions/${encodeURIComponent(versionId)}/archive`,
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
  }
});

test("admin can create, validate, and publish a connector mapping version from the browser", async ({ page }) => {
  // Save, validate and publish with four page loads and three polls takes about 44 s on its own, right at the 45 s
  // default.
  test.setTimeout(120_000);
  const adminToken = await apiLogin("admin");
  const category = await createCategory(adminToken, uniqueName("mapping-publish-cat"));
  const product = await createProduct(adminToken, {
    title: uniqueName("mapping-publish-product"),
    brand: "Vexa PIM",
    description: "browser mapping publish flow",
    categoryId: category.id,
    status: "draft",
    hsnCode: "62046200",
    gstRate: 12,
    attributes: {
      color: "black",
      size: "M",
    },
  });
  const targetCategoryValue = uniqueName("flipkart-target").toLowerCase();
  const mappingsUrl = buildMappingsUrl(category.id, product.id, {
    step: "map",
    publishCategoryId: targetCategoryValue,
  });

  let versionId = null;

  try {
    await loginViaUi(page, "admin");
    await page.goto(mappingsUrl, { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Channel Mapping" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Step 2: Map Required Fields" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Change scope" })).toBeVisible();

    const requiredMappings = [
      ["title", "Title"],
      ["hsnCode", "HSN code"],
      ["gstRate", "GST rate"],
      ["attributes.size", "Size (Attribute)"],
      ["attributes.color", "Color (Attribute)"],
    ];
    // When the system default already maps every required field the editor collapses those rows under
    // "Show mapped required fields"; open that section before touching them.
    const mappedRequiredToggle = page.locator("summary", { hasText: "Show mapped required fields" });
    if (await mappedRequiredToggle.isVisible()) {
      await mappedRequiredToggle.click();
    }
    for (const [targetField, sourceField] of requiredMappings) {
      const fieldSelect = page.locator(`select[name="mapTarget::${targetField}"]`);
      await expect(fieldSelect).toBeVisible();
      await fieldSelect.selectOption({ label: sourceField });
    }

    const fallbackCategoryField = page.getByLabel("Default fallback category");
    if (await fallbackCategoryField.isVisible()) {
      await fallbackCategoryField.fill(targetCategoryValue);
    }
    await submitContainingForm(page.getByRole("button", { name: "Save draft version" }));

    await expect(page).toHaveURL(/step=review/, { timeout: 30000 });

    await expect.poll(async () => {
      const versions = await listVersions(adminToken, category.id);
      const draftVersion = Array.isArray(versions)
        ? versions.find((candidate) => String(candidate.lifecycleState) === "draft")
        : null;
      versionId = draftVersion?.id ?? versionId;
      return draftVersion?.lifecycleState ?? "";
    }, { timeout: 30000, intervals: [1000] }).toBe("draft");

    await page.goto(buildMappingsUrl(category.id, product.id, { step: "review", publishCategoryId: targetCategoryValue }), {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("heading", { name: "Publish Readiness" })).toBeVisible();
    const draftRow = page.locator("tbody tr", { hasText: versionId }).first();
    await expect(draftRow).toBeVisible();
    await submitContainingForm(draftRow.getByRole("button", { name: "Validate" }));

    await expect.poll(async () => {
      const versions = await listVersions(adminToken, category.id);
      const version = Array.isArray(versions)
        ? versions.find((candidate) => String(candidate.id) === String(versionId))
        : null;
      return version?.lifecycleState ?? "";
    }, { timeout: 30000, intervals: [1000] }).toBe("validated");

    await page.goto(buildMappingsUrl(category.id, product.id, { step: "review", publishCategoryId: targetCategoryValue }), {
      waitUntil: "domcontentloaded",
    });
    const validatedRow = page.locator("tbody tr", { hasText: versionId }).first();
    await expect(validatedRow).toBeVisible();
    const fallbackAcknowledgement = validatedRow.getByRole("checkbox", { name: /Acknowledge fallback/i });
    if (await fallbackAcknowledgement.count()) {
      await fallbackAcknowledgement.check();
      await submitContainingForm(validatedRow.getByRole("button", { name: "Save acknowledgement" }));
      await expect(page).toHaveURL(/fallbackAcknowledged=true/, { timeout: 30000 });
      await page.goto(buildMappingsUrl(category.id, product.id, { step: "review", publishCategoryId: targetCategoryValue, fallbackAcknowledged: "true", fallbackAckVersionId: versionId }), {
        waitUntil: "domcontentloaded",
      });
    }

    const readyToPublishRow = page.locator("tbody tr", { hasText: versionId }).first();
    await expect(readyToPublishRow).toBeVisible();
    await readyToPublishRow.locator("summary").filter({ hasText: "Publish" }).click();
    const publishPanel = readyToPublishRow.locator("details[open]").first();
    await publishPanel.getByLabel("Step-up re-authentication").fill(STEP_UP_PASSWORD);
    await submitContainingForm(publishPanel.getByRole("button", { name: "Publish" }));

    await expect.poll(async () => {
      const versions = await listVersions(adminToken, category.id);
      const version = Array.isArray(versions)
        ? versions.find((candidate) => String(candidate.id) === String(versionId))
        : null;
      return version?.lifecycleState ?? "";
    }, { timeout: 30000, intervals: [1000] }).toBe("published");

    await page.goto(buildMappingsUrl(category.id, product.id, { step: "review", publishCategoryId: targetCategoryValue }), {
      waitUntil: "domcontentloaded",
    });
    const publishedRow = page.locator("tbody tr", { hasText: versionId }).first();
    await expect(publishedRow).toBeVisible();
    await expect(publishedRow.getByText("Live").last()).toBeVisible();
  } finally {
    if (versionId) {
      try {
        const stepUpToken = await issueStepUpToken(adminToken);
        await apiRequestWithHeaders(
          "POST",
          `/marketplace/connectors/flipkart/mappings/versions/${encodeURIComponent(versionId)}/archive`,
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
