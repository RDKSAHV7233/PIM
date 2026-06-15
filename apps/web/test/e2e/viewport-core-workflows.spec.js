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
  if (!response.ok) throw new Error(`${method} ${route} → ${response.status}: ${JSON.stringify(payload)}`);
  return payload;
}

async function issueStepUpToken(token) {
  const res = await apiRequestWithHeaders("POST", "/auth/step-up", token, { password: STEP_UP_PASSWORD, scope: "mapping_high_risk" });
  return String(res.stepUpToken ?? "").trim();
}

async function listVersions(token, categoryId) {
  return apiRequest(
    "GET",
    `/marketplace/connectors/flipkart/mappings/versions?categoryScope=${encodeURIComponent(categoryId)}&includeArchived=true`,
    token,
  );
}

async function submitContainingForm(locator) {
  await locator.evaluate((node) => {
    const form = node.closest("form");
    if (!(form instanceof HTMLFormElement)) throw new Error("Expected control to live inside a form.");
    form.requestSubmit();
  });
}

const VIEWPORTS = [
  { name: "mobile-375", width: 375, height: 812, expectsMobileCards: true },
  { name: "tablet-768", width: 768, height: 1024, expectsMobileCards: true },
  { name: "desktop-1024", width: 1024, height: 900, expectsMobileCards: false },
  { name: "desktop-1440", width: 1440, height: 960, expectsMobileCards: false },
];

test.describe("Mapping publish workflow at 375px mobile viewport", () => {
  test("required field selects are reachable and draft can be submitted at mobile width", async ({ page }) => {
    const adminToken = await apiLogin("admin");
    const category = await createCategory(adminToken, uniqueName("mobile-mapping-cat"));
    const product = await createProduct(adminToken, {
      title: uniqueName("mobile-mapping-product"),
      brand: "Vexa PIM",
      description: "mobile mapping viewport test",
      categoryId: category.id,
      status: "draft",
      hsnCode: "62046200",
      gstRate: 12,
      attributes: { color: "red", size: "S" },
    });
    const targetCategoryValue = uniqueName("fk-mobile-target").toLowerCase();
    let versionId = null;

    try {
      await page.setViewportSize({ width: 375, height: 812 });
      await loginViaUi(page, "admin");

      const mappingsUrl = `/channels/mappings?channel=flipkart&categoryId=${encodeURIComponent(String(category.id))}&productId=${encodeURIComponent(String(product.id))}`;
      await page.goto(mappingsUrl, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "Step 2: Build draft mapping" })).toBeVisible();

      // Target category field is visible at mobile width
      const targetCategoryControl = page.locator('[name="targetCategory"]').first();
      await expect(targetCategoryControl).toBeVisible();
      const tag = await targetCategoryControl.evaluate((n) => n.tagName.toLowerCase());
      if (tag === "select") {
        const optionValue = await targetCategoryControl.locator("option").nth(0).getAttribute("value");
        if (!optionValue) throw new Error("Mobile mapping test requires a target category option.");
        await targetCategoryControl.selectOption(optionValue);
      } else {
        await targetCategoryControl.fill(targetCategoryValue);
      }

      // Required field mapping selects are visible and operable at 375px
      const requiredMappings = [
        ["title", "Title"],
        ["hsnCode", "HSN code"],
        ["gstRate", "GST rate"],
        ["attributes.size", "attributes.size"],
        ["attributes.color", "attributes.color"],
      ];
      for (const [targetField, sourceField] of requiredMappings) {
        const fieldSelect = page.locator(`select[name="mapTarget::${targetField}"]`);
        await expect(fieldSelect).toBeVisible();
        // Verify select is within horizontal bounds (no overflow forcing horizontal scroll)
        const box = await fieldSelect.boundingBox();
        expect(box.x + box.width).toBeLessThanOrEqual(375 + 4); // 4px tolerance for border
        await fieldSelect.selectOption({ label: sourceField });
      }

      // Save button is reachable and submittable
      const saveButton = page.getByRole("button", { name: "Save draft version" });
      await expect(saveButton).toBeVisible();
      await submitContainingForm(saveButton);

      await expect(page).toHaveURL(/\/channels\/mappings/, { timeout: 30000 });

      // Confirm draft was persisted
      await expect.poll(async () => {
        const versions = await listVersions(adminToken, category.id);
        const draft = Array.isArray(versions)
          ? versions.find((v) => String(v.lifecycleState) === "draft")
          : null;
        versionId = draft?.id ?? versionId;
        return draft?.lifecycleState ?? "";
      }, { timeout: 30000 }).toBe("draft");
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
      try { await deleteProduct(adminToken, product.id); } catch {}
      try { await purgeProduct(adminToken, product.id); } catch {}
      try { await deleteCategory(adminToken, category.id); } catch {}
    }
  });
});

for (const viewport of VIEWPORTS) {
  test(`core workflow actions stay visible at ${viewport.name}`, async ({ page }) => {
    const adminToken = await apiLogin("admin");
    const category = await createCategory(adminToken, uniqueName(`e2e-${viewport.name}-cat`));
    const product = await createProduct(adminToken, {
      title: uniqueName(`e2e-${viewport.name}-product`),
      brand: "Vexa PIM",
      description: "Responsive verification product",
      categoryId: category.id,
      status: "draft",
      gstRate: 18,
      attributes: {},
    });

    try {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await loginViaUi(page, "admin");

      await page.goto(`/products/${product.id}?tab=channels`, { waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: "Channel readiness and queued exports" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Fix mapping" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Review quality blockers" })).toBeVisible();

      const legacyTemplateDetails = page
        .locator("details")
        .filter({ has: page.locator("summary").filter({ hasText: "Legacy template inventory (transition only)" }) });
      await legacyTemplateDetails.evaluate((node) => {
        node.open = true;
      });
      if (viewport.expectsMobileCards) {
        await expect(
          legacyTemplateDetails.getByText("No mapping templates found for this category and channel.").first(),
        ).toBeVisible();
      } else {
        await expect(
          legacyTemplateDetails.getByText("No mapping templates found for this category and channel.").first(),
        ).toBeVisible();
      }

      const exportAttemptDetails = page
        .locator("details")
        .filter({ has: page.locator("summary").filter({ hasText: "View queued export attempts and recovery actions" }) });
      await exportAttemptDetails.evaluate((node) => {
        node.open = true;
      });
      if (viewport.expectsMobileCards) {
        await expect(
          exportAttemptDetails
            .getByText("No submission jobs created yet. Queue an export job to start channel processing.")
            .first(),
        ).toBeVisible();
      } else {
        await expect(
          exportAttemptDetails
            .getByText("No submission jobs created yet. Queue an export job to start channel processing.")
            .first(),
        ).toBeVisible();
      }

      await page.goto(
        `/channels/mappings?categoryId=${encodeURIComponent(category.id)}&channel=shopify&productId=${encodeURIComponent(product.id)}`,
        { waitUntil: "domcontentloaded" },
      );
      await expect(page.getByRole("heading", { name: "Step 2: Build draft mapping" })).toBeVisible();

      if (viewport.expectsMobileCards) {
        await expect(page.locator('select[id$="-field"]').first()).toBeVisible();
      } else {
        await expect(page.getByText("Sample product value").first()).toBeVisible();
      }
    } finally {
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
