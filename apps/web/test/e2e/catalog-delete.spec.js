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
} = require("./helpers/tej-pim.cjs");

test("editor can archive a product from the workbench", async ({ page }) => {
  const adminToken = await apiLogin("admin");
  const editorToken = await apiLogin("editor");
  const category = await createCategory(adminToken, uniqueName("e2e-archive-cat"));
  const product = await createProduct(editorToken, {
    title: uniqueName("e2e-archive-product"),
    brand: "Vexa PIM",
    description: "archive flow",
    categoryId: category.id,
    status: "draft",
    hsnCode: "62046200",
    gstRate: 18,
    attributes: {},
  });

  try {
    await loginViaUi(page, "editor");
    await page.goto(`/catalog/products?search=${encodeURIComponent(product.title)}`, { waitUntil: "domcontentloaded" });
    page.once("dialog", (dialog) => dialog.accept());
    const row = page.locator("tbody tr", { hasText: product.title }).first();
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Delete" }).click();
    await expect(page).toHaveURL(/deleteStatus=deleted/);
    const response = await page.request.get(
      `${DEFAULT_API_URL}/catalog/products/${product.id}`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
        failOnStatusCode: false,
      },
    );
    expect(response.status()).toBe(404);
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

test("admin sees archive and permanent delete safeguards on product detail", async ({ page }) => {
  const adminToken = await apiLogin("admin");
  const category = await createCategory(adminToken, uniqueName("e2e-purge-cat"));
  const product = await createProduct(adminToken, {
    title: uniqueName("e2e-purge-product"),
    brand: "Vexa PIM",
    description: "purge flow",
    categoryId: category.id,
    status: "draft",
    hsnCode: "62046200",
    gstRate: 18,
    attributes: {},
  });

  try {
    await loginViaUi(page, "admin");
    await page.goto(`/products/${product.id}`, { waitUntil: "domcontentloaded" });
    const archiveButton = page.getByRole("button", { name: "Archive product" });
    await archiveButton.scrollIntoViewIfNeeded();
    await expect(archiveButton).toBeVisible();
    const confirmDelete = page.getByLabel("Confirm permanent delete");
    await confirmDelete.scrollIntoViewIfNeeded();
    await expect(confirmDelete).toBeVisible();
    await expect(confirmDelete).toHaveAttribute("placeholder", new RegExp(product.id));
    const purgeButton = page.getByRole("button", { name: "Permanently delete" });
    await purgeButton.scrollIntoViewIfNeeded();
    await expect(purgeButton).toBeVisible();
    await expect(
      page.getByText("This removes the product permanently. Type", { exact: false }),
    ).toBeVisible();
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

test("admin sees blocked and allowed category delete states", async ({ page }) => {
  const adminToken = await apiLogin("admin");
  const blockedParent = await createCategory(adminToken, uniqueName("e2e-blocked-parent"));
  const blockedChild = await createCategory(adminToken, uniqueName("e2e-blocked-child"), blockedParent.id);
  const allowed = await createCategory(adminToken, uniqueName("e2e-allowed-category"));

  try {
    await loginViaUi(page, "admin");
    await page.goto("/catalog/categories", { waitUntil: "domcontentloaded" });

    const blockedRow = page.locator("tbody tr", { hasText: blockedParent.name }).first();
    await expect(blockedRow).toBeVisible();
    const blockedDelete = blockedRow.getByRole("button", { name: "Delete" });
    await expect(blockedDelete).toBeDisabled();

    page.once("dialog", (dialog) => dialog.accept());
    const allowedRow = page.locator("tbody tr", { hasText: allowed.name }).first();
    await expect(allowedRow).toBeVisible();
    await allowedRow.getByRole("button", { name: "Delete" }).click();
    await expect(page).toHaveURL(/deleteStatus=deleted/);
    await expect(page.getByText("Category deleted successfully.")).toBeVisible();
  } finally {
    try {
      await deleteCategory(adminToken, blockedChild.id);
    } catch {}
    try {
      await deleteCategory(adminToken, blockedParent.id);
    } catch {}
    try {
      await deleteCategory(adminToken, allowed.id);
    } catch {}
  }
});
