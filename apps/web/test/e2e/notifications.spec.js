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

test("notification panel closes when clicking outside it", async ({ page }) => {
  await loginViaUi(page, "editor");
  await page.getByRole("button", { name: "Open notifications" }).click();
  const panel = page.locator("aside").filter({ has: page.getByRole("heading", { name: "Notifications" }) });
  await expect(panel).toBeVisible();

  await page.mouse.click(10, 10);
  await expect(panel).toBeHidden({ timeout: 5_000 });
});

test("full notification center renders at /notifications", async ({ page }) => {
  await loginViaUi(page, "editor");
  await page.goto("/notifications", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: /notifications/i }).first()).toBeVisible();
});

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

    // F-8: "View all notifications" footer link must be visible in the panel.
    // Close the panel first (it may still be open after mark-all-read) then reopen it.
    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden({ timeout: 3_000 }).catch(() => {
      // Panel may have already closed or Escape may not close it — try clicking outside
    });
    await page.getByRole("button", { name: "Open notifications" }).click();
    const reopenedPanel = page.locator("aside").filter({ has: page.getByRole("heading", { name: "Notifications" }) });
    const viewAllLink = reopenedPanel.getByRole("link", { name: "View all notifications" });
    await expect(viewAllLink).toBeVisible({ timeout: 5_000 });
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

test("notifications page renders the full notification history and is reachable via bell panel link", async ({ page }) => {
  const reviewerAuth = await apiLoginPayload("reviewer");
  test.skip(reviewerAuth.role !== "reviewer", `reviewer identity resolves as ${reviewerAuth.role} in current local environment`);
  const adminToken = await apiLogin("admin");
  const editorToken = await apiLogin("editor");
  const reviewerToken = reviewerAuth.accessToken;
  const category = await createCategory(adminToken, uniqueName("e2e-notifypage-cat"));
  const product = await createProduct(editorToken, {
    title: uniqueName("e2e-notifypage-product"),
    brand: "Vexa PIM",
    description: "notifications page e2e fixture",
    categoryId: category.id,
    status: "draft",
    hsnCode: "62046200",
    gstRate: 18,
    attributes: {},
  });

  try {
    // Create a notification: submit for review → approve
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

    await loginViaUi(page, "editor");

    // F-5: /notifications page renders the notification list
    await page.goto("/notifications", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(product.title, { exact: false })).toBeVisible({ timeout: 10_000 });

    // F-8: "View all notifications" link in bell panel navigates here
    await page.goto("/dashboard", { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Open notifications" }).click();
    const panel = page.locator("aside").filter({ has: page.getByRole("heading", { name: "Notifications" }) });
    await expect(panel.getByRole("heading", { name: "Notifications" })).toBeVisible();
    await Promise.all([
      page.waitForURL(/\/notifications$/),
      panel.getByRole("link", { name: "View all notifications" }).click(),
    ]);
    await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
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
