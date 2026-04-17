const { test, expect } = require("@playwright/test");
const {
  apiLogin,
  apiLoginPayload,
  createCategory,
  createProduct,
  deleteCategory,
  deleteProduct,
  listNotifications,
  loginViaUi,
  purgeProduct,
  reviewProduct,
  uniqueName,
  updateProduct,
} = require("./helpers/vexa-pim.cjs");

test("editor can open notification center and mark approval notifications read", async ({ page }) => {
  const reviewerAuth = await apiLoginPayload("reviewer");
  test.skip(reviewerAuth.role !== "reviewer", `reviewer identity resolves as ${reviewerAuth.role} in current local environment`);
  const adminToken = await apiLogin("admin");
  const editorToken = await apiLogin("editor");
  const reviewerToken = reviewerAuth.accessToken;
  const category = await createCategory(adminToken, uniqueName("e2e-notify-cat"));
  const product = await createProduct(editorToken, {
    title: uniqueName("e2e-notify-product"),
    brand: "Vexa PIM",
    description: "notification approval flow",
    categoryId: category.id,
    status: "draft",
    hsnCode: "62046200",
    gstRate: 18,
    attributes: {},
  });

  try {
    await updateProduct(editorToken, product.id, {
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
    await reviewProduct(reviewerToken, product.id, "approved", undefined);

    const apiList = await listNotifications(editorToken);
    const notification = apiList.items.find((item) => item.eventType === "approval_decision" && String(item.message).includes(product.title));
    expect(notification).toBeTruthy();

    await loginViaUi(page, "editor");
    await page.getByRole("button", { name: "Open notifications" }).click();
    const panel = page.locator("aside").filter({ has: page.getByRole("heading", { name: "Notifications" }) });
    await expect(panel.getByRole("heading", { name: "Notifications" })).toBeVisible();
    await expect(panel.getByText(product.title, { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Mark all read" }).click();
    await expect(panel.getByText("You're up to date")).toBeVisible();

    const afterRead = await listNotifications(editorToken);
    const afterItem = afterRead.items.find((item) => item.id === notification.id);
    expect(afterItem.readAt).toBeTruthy();
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
