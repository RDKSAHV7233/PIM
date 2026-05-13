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
  updateProduct,
} = require("./helpers/vexa-pim.cjs");

const DEFAULT_MAPPING = {
  title: "title",
  description: "description",
  brand: "brand",
  hsnCode: "hsnCode",
  gstRate: "gstRate",
  status: "status",
  attributes: "attributes",
};

test("admin can walk the core demo-tenant operator journey end to end", async ({ page }) => {
  const adminToken = await apiLogin("admin");
  const reviewerToken = await apiLogin("reviewer");
  const category = await createCategory(adminToken, uniqueName("TEST-demo-tenant-cat"));
  const product = await createProduct(adminToken, {
    title: uniqueName("TEST-demo-tenant-product"),
    brand: "Vexa PIM",
    description: "TEST demo tenant journey product",
    categoryId: category.id,
    status: "draft",
    hsnCode: "62046200",
    gstRate: 18,
    attributes: {
      color: "Black",
      size: "M",
    },
  });
  const importJob = await apiRequest("POST", "/bulk-import/jobs", adminToken, {
    categoryId: category.id,
    sourceFormat: "json",
    sourceName: `${uniqueName("TEST-demo-import")}.json`,
    rows: [
      {
        title: uniqueName("TEST-demo-import-row"),
        description: "TEST demo import row",
        brand: "Vexa PIM",
        status: "draft",
        hsnCode: "62046200",
        gstRate: 18,
        attributes: { color: "Blue" },
      },
    ],
    mapping: DEFAULT_MAPPING,
    chunkSize: 1,
    maxRetries: 1,
  });

  let importedProductId = null;

  try {
    await apiRequest("POST", `/bulk-import/jobs/${encodeURIComponent(importJob.id)}/process`, adminToken, { chunkSize: 1 });
    const refreshedImport = await apiRequest("GET", `/bulk-import/jobs/${encodeURIComponent(importJob.id)}`, adminToken);
    importedProductId = refreshedImport.rows?.find((row) => row.productId)?.productId ?? null;

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
    await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();

    await page.goto(`/operations/imports?bulkJobId=${encodeURIComponent(importJob.id)}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Operations Imports" })).toBeVisible();
    await expect(page.getByText("Import result summary")).toBeVisible();

    await page.goto("/quality/issues", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Issue Inbox" })).toBeVisible();
    await expect(page.getByText("Grouped Impact")).toBeVisible();

    await page.goto("/quality/approvals", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Approval Queue" })).toBeVisible();
    await expect(page.getByText("Revision Evidence Coverage")).toBeVisible();

    await page.goto(`/channels/mappings?channel=flipkart&categoryId=${encodeURIComponent(category.id)}&productId=${encodeURIComponent(product.id)}`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("heading", { name: "Mapping Workbench" })).toBeVisible();

    await page.goto("/connectors", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Connectors" })).toBeVisible();
    await expect(page.getByText("Connector capability matrix").first()).toBeVisible();

    await page.goto(`/products/${encodeURIComponent(product.id)}?tab=channels`, { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Export confirmation")).toBeVisible();
    await expect(page.getByText("Latest export result summary")).toBeVisible();

    await page.goto("/operations/jobs", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Jobs", exact: true })).toBeVisible();
    await expect(page.getByText("Use Jobs vs Submissions")).toBeVisible();

    await page.goto("/admin/audit", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Audit Logs" })).toBeVisible();
    await expect(page.getByText("Governance summary")).toBeVisible();

    await page.goto("/admin/users", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Users & Roles" })).toBeVisible();
    await expect(page.getByText("Access Review Checklist")).toBeVisible();
  } finally {
    if (importedProductId) {
      try {
        await deleteProduct(adminToken, importedProductId);
      } catch {}
      try {
        await purgeProduct(adminToken, importedProductId);
      } catch {}
    }
    try {
      await apiRequest("POST", `/catalog/products/${encodeURIComponent(product.id)}/review-decision`, reviewerToken, {
        status: "rejected",
        note: "playwright cleanup",
      });
    } catch {}
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
