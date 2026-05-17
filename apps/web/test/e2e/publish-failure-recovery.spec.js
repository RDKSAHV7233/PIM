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
  reviewProduct,
  uniqueName,
  updateProduct,
} = require("./helpers/vexa-pim.cjs");

test("admin can follow a failed publish from jobs into recovery guidance", async ({ page }) => {
  const adminToken = await apiLogin("admin");
  const category = await createCategory(adminToken, uniqueName("TEST-publish-recovery-cat"));
  const product = await createProduct(adminToken, {
    title: uniqueName("TEST-publish-recovery-product"),
    brand: "Vexa PIM",
    description: "TEST publish recovery browser flow",
    categoryId: category.id,
    status: "draft",
    hsnCode: "62046200",
    gstRate: 18,
    attributes: { color: "Black" },
  });

  let exportJobId = null;

  try {
    // Export requires approved/active status — advance through the review workflow first.
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
    await reviewProduct(adminToken, product.id, "approved", "auto-approved for export failure test");

    const exportJob = await apiRequest("POST", `/marketplace/products/${encodeURIComponent(product.id)}/export-jobs`, adminToken, {
      channel: "flipkart",
      maxRetries: 1,
    });
    exportJobId = String(exportJob.id);
    const processed = await apiRequest("POST", `/marketplace/export-jobs/${encodeURIComponent(exportJobId)}/process`, adminToken);
    expect(["failed", "dead_letter"]).toContain(String(processed.status));

    await loginViaUi(page, "admin");

    await page.goto("/operations/jobs", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Jobs", exact: true })).toBeVisible();
    await expect(page.getByText("Recovery Now")).toBeVisible();
    await expect(page.getByText("Use Jobs vs Submissions")).toBeVisible();

    const exportReference = page.getByText(exportJobId, { exact: false }).first();
    await expect(exportReference).toBeVisible();

    await page.goto(`/channels/submissions?productId=${encodeURIComponent(product.id)}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Submissions", exact: true })).toBeVisible();
    await expect(page.getByText("Submission triage guide")).toBeVisible();
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
