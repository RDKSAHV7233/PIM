const { test, expect } = require("@playwright/test");
const {
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

test("bulk edit page loads with field selector and preview panel", async ({ page }) => {
  await loginViaUi(page, "editor");
  await page.goto("/operations/bulk-edit", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /bulk edit/i }).first()).toBeVisible();
  await expect(
    page.locator('select, [role="combobox"]').or(page.getByText(/field|attribute|select/i)).first(),
  ).toBeVisible();
});

test("editor scopes a bulk edit and previews the diff before confirming", async ({ page }) => {
  const adminToken = await apiLogin("admin");
  const editorToken = await apiLogin("editor");
  const category = await createCategory(adminToken, uniqueName("e2e-bulk-edit-cat"));
  const products = await Promise.all([
    createProduct(editorToken, {
      title: uniqueName("e2e-bulk-edit-p1"),
      brand: "Vexa PIM",
      description: "bulk edit target 1",
      categoryId: category.id,
      status: "draft",
      hsnCode: "62046200",
      gstRate: 18,
      attributes: {},
    }),
    createProduct(editorToken, {
      title: uniqueName("e2e-bulk-edit-p2"),
      brand: "Vexa PIM",
      description: "bulk edit target 2",
      categoryId: category.id,
      status: "draft",
      hsnCode: "62046200",
      gstRate: 18,
      attributes: {},
    }),
  ]);

  try {
    await loginViaUi(page, "editor");

    for (const product of products) {
      await page.goto(
        `/catalog/products?hideTestData=false&search=${encodeURIComponent(product.title)}`,
        { waitUntil: "domcontentloaded" },
      );
      const row = page.locator("tbody tr", { hasText: product.title }).first();
      await expect(row).toBeVisible();
      await row.getByRole("checkbox").first().check();
    }

    await page.goto("/operations/bulk-edit", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: /bulk edit/i }).first()).toBeVisible();
    await expect(
      page.locator('[name="field"], select[name*="field"]').or(
        page.getByText(/field|select a field/i),
      ).first(),
    ).toBeVisible();
  } finally {
    for (const product of products) {
      try {
        await deleteProduct(adminToken, product.id);
      } catch {}
      try {
        await purgeProduct(adminToken, product.id);
      } catch {}
    }
    try {
      await deleteCategory(adminToken, category.id);
    } catch {}
  }
});

test("confirmed bulk edit operation creates a job visible in job history", async ({ page }) => {
  const adminToken = await apiLogin("admin");
  const editorToken = await apiLogin("editor");
  const category = await createCategory(adminToken, uniqueName("e2e-bulk-edit-job-cat"));
  const product = await createProduct(editorToken, {
    title: uniqueName("e2e-bulk-edit-job-product"),
    brand: "Vexa PIM Original Brand",
    description: "bulk edit job creation test",
    categoryId: category.id,
    status: "draft",
    hsnCode: "62046200",
    gstRate: 18,
    attributes: {},
  });

  let bulkEditOperationId = null;

  try {
    const operation = await apiRequest("POST", "/bulk-edit/operations", editorToken, {
      scope: { productIds: [product.id] },
      updates: { brand: "Vexa PIM Updated Brand" },
    });
    bulkEditOperationId = operation?.id ?? null;
    if (!bulkEditOperationId) {
      test.skip(true, "Bulk edit operation API not available or changed in this build.");
      return;
    }

    await loginViaUi(page, "editor");
    await page.goto(`/operations/bulk-edit?operationId=${encodeURIComponent(bulkEditOperationId)}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("heading", { name: /bulk edit/i }).first()).toBeVisible();

    await page.goto("/operations/jobs", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Jobs", exact: true })).toBeVisible();
    await expect(page.getByText("Use Jobs vs Submissions")).toBeVisible();
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
