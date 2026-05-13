const { test, expect } = require("@playwright/test");
const {
  apiLogin,
  createCategory,
  createProduct,
  deleteCategory,
  deleteProduct,
  loginViaUi,
  purgeProduct,
  uniqueName,
} = require("./helpers/vexa-pim.cjs");

const VIEWPORTS = [
  { name: "mobile-375", width: 375, height: 812, expectsMobileCards: true },
  { name: "tablet-768", width: 768, height: 1024, expectsMobileCards: true },
  { name: "desktop-1024", width: 1024, height: 900, expectsMobileCards: false },
  { name: "desktop-1440", width: 1440, height: 960, expectsMobileCards: false },
];

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
