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

test("admin can create, validate, and publish a connector mapping version from the browser", async ({ page }) => {
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
  const mappingsUrl = buildMappingsUrl(category.id, product.id, { showContext: "1" });

  let versionId = null;

  try {
    await loginViaUi(page, "admin");
    await page.goto(mappingsUrl, { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Mappings" })).toBeVisible();
    await expect(page.getByText(product.title, { exact: true })).toBeVisible();
    await expect(page.getByText("Publish Readiness (Hard Gate)")).toBeVisible();

    const targetCategoryControl = page.locator('[name="targetCategory"]').first();
    await expect(targetCategoryControl).toBeVisible();
    const targetCategoryTag = await targetCategoryControl.evaluate((node) => node.tagName.toLowerCase());
    if (targetCategoryTag === "select") {
      const optionValue = await targetCategoryControl.locator("option").nth(0).getAttribute("value");
      if (!optionValue) {
        throw new Error("Mappings publish e2e requires a target category option.");
      }
      await targetCategoryControl.selectOption(optionValue);
    } else {
      await targetCategoryControl.fill(targetCategoryValue);
    }

    const requiredMappings = [
      ["title", "Title"],
      ["hsnCode", "HSN code"],
      ["gstRate", "GST rate"],
      ["attributes.size", "attributes.size"],
      ["attributes.color", "attributes.color"],
    ];
    for (const [targetField, sourceField] of requiredMappings) {
      const row = page.locator("tr", { hasText: targetField }).first();
      await expect(row).toBeVisible();
      await row.locator("select").first().selectOption({ label: sourceField });
    }

    await page.getByLabel("Default fallback category").fill(targetCategoryValue);
    await submitContainingForm(page.getByRole("button", { name: "Save draft version" }));

    await expect(page).toHaveURL(new RegExp(`/channels/mappings\\?`));

    await expect.poll(async () => {
      const versions = await listVersions(adminToken, category.id);
      const draftVersion = Array.isArray(versions)
        ? versions.find((candidate) => String(candidate.lifecycleState) === "draft")
        : null;
      versionId = draftVersion?.id ?? versionId;
      return draftVersion?.lifecycleState ?? "";
    }).toBe("draft");

    await page.goto(buildMappingsUrl(category.id, product.id, { showHistory: "1" }), {
      waitUntil: "domcontentloaded",
    });
    const draftRow = page.locator("tbody tr", { hasText: versionId }).first();
    await expect(draftRow).toBeVisible();
    await submitContainingForm(draftRow.getByRole("button", { name: "Validate" }));

    await expect.poll(async () => {
      const versions = await listVersions(adminToken, category.id);
      const version = Array.isArray(versions)
        ? versions.find((candidate) => String(candidate.id) === String(versionId))
        : null;
      return version?.lifecycleState ?? "";
    }).toBe("validated");

    await page.goto(buildMappingsUrl(category.id, product.id, { showHistory: "1" }), {
      waitUntil: "domcontentloaded",
    });
    const validatedRow = page.locator("tbody tr", { hasText: versionId }).first();
    await expect(validatedRow).toBeVisible();
    await validatedRow.locator("summary").filter({ hasText: "Publish" }).click();
    const publishPanel = validatedRow.locator("details[open]").first();
    await publishPanel.getByLabel("Step-up re-authentication").fill(STEP_UP_PASSWORD);
    await submitContainingForm(publishPanel.getByRole("button", { name: "Publish" }));

    await expect.poll(async () => {
      const versions = await listVersions(adminToken, category.id);
      const version = Array.isArray(versions)
        ? versions.find((candidate) => String(candidate.id) === String(versionId))
        : null;
      return version?.lifecycleState ?? "";
    }).toBe("published");

    await page.goto(buildMappingsUrl(category.id, product.id, { showHistory: "1" }), {
      waitUntil: "domcontentloaded",
    });
    const publishedRow = page.locator("tbody tr", { hasText: versionId }).first();
    await expect(publishedRow).toBeVisible();
    await expect(publishedRow.getByText("Live")).toBeVisible();
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
