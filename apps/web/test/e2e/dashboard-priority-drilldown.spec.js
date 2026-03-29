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
  updateProduct,
} = require("./helpers/tej-pim.cjs");

test("admin can drill from dashboard priority queue into product detail", async ({ page }) => {
  const adminToken = await apiLogin("admin");
  const category = await createCategory(adminToken, uniqueName("e2e-dashboard-cat"));
  const product = await createProduct(adminToken, {
    title: uniqueName("e2e-dashboard-priority"),
    brand: "TEJ PIM",
    description: "",
    categoryId: category.id,
    status: "draft",
    gstRate: 18,
    attributes: {},
  });

  try {
    await updateProduct(adminToken, product.id, {
      expectedVersion: product.version,
      title: product.title,
      description: product.description,
      brand: product.brand,
      categoryId: product.categoryId,
      hsnCode: product.hsnCode,
      gstRate: product.gstRate,
      attributes: product.attributes,
      status: "in_review",
    });

    await loginViaUi(page, "admin");
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Top products to fix now" })).toBeVisible();
    const productRow = page.locator("tbody tr", { hasText: product.title }).first();
    await expect(productRow).toBeVisible();
    await expect(productRow.getByText("Awaiting review")).toBeVisible();

    await productRow.getByRole("link", { name: "Open product" }).click();
    await page.waitForURL(new RegExp(`/products/${product.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    await expect(page.getByRole("heading", { name: product.title })).toBeVisible();
    await expect(page.getByText("Status: in_review")).toBeVisible();
    await expect(page.getByRole("button", { name: "Validate" })).toBeVisible();
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
