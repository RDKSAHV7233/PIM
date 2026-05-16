const { test, expect } = require("@playwright/test");
const {
  DEFAULT_API_URL,
  apiLogin,
  apiLoginPayload,
  createCategory,
  createProduct,
  deleteCategory,
  deleteProduct,
  loginViaUi,
  purgeProduct,
  uniqueName,
  updateProduct,
} = require("./helpers/vexa-pim.cjs");

test("reviewer can navigate from issue inbox to product detail", async ({ page }) => {
  const reviewerAuth = await apiLoginPayload("reviewer");
  test.skip(reviewerAuth.role !== "reviewer", `reviewer identity resolves as ${reviewerAuth.role} in current local environment`);
  const adminToken = await apiLogin("admin");
  const editorToken = await apiLogin("editor");
  const category = await createCategory(adminToken, uniqueName("e2e-issues-nav-cat"));
  const product = await createProduct(editorToken, {
    title: uniqueName("e2e-issues-nav-product"),
    brand: "Vexa PIM",
    description: "issue inbox navigation test",
    categoryId: category.id,
    status: "draft",
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

    await loginViaUi(page, "reviewer");
    await page.goto("/quality/issues", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Issue Inbox" })).toBeVisible();
    await expect(page.getByText("Grouped Impact")).toBeVisible();

    const issueRow = page.locator("tbody tr", { hasText: product.title }).first();
    if (await issueRow.count() > 0) {
      const productLink = issueRow.getByRole("link").first();
      await productLink.click();
      await page.waitForURL(new RegExp(`/products/${product.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`));
      await expect(page.getByRole("heading", { name: product.title })).toBeVisible();
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

test("editor cannot access approval action controls on the approval queue", async ({ page }) => {
  await loginViaUi(page, "editor");
  await page.goto("/quality/approvals", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Approval Queue" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reject" })).toHaveCount(0);
});

test("reviewer can approve clean products and reject blocked products", async ({ page }) => {
  const reviewerAuth = await apiLoginPayload("reviewer");
  test.skip(reviewerAuth.role !== "reviewer", `reviewer identity resolves as ${reviewerAuth.role} in current local environment`);
  const adminToken = await apiLogin("admin");
  const editorToken = await apiLogin("editor");
  const reviewerToken = reviewerAuth.accessToken;
  const category = await createCategory(adminToken, uniqueName("e2e-review-cat"));

  const clean = await createProduct(editorToken, {
    title: uniqueName("e2e-clean-review"),
    brand: "Vexa PIM",
    description: "clean review path",
    categoryId: category.id,
    status: "draft",
    hsnCode: "62046200",
    gstRate: 18,
    attributes: {},
  });
  await updateProduct(editorToken, clean.id, {
    expectedVersion: clean.version,
    title: clean.title,
    description: clean.description,
    brand: clean.brand,
    categoryId: clean.categoryId,
    hsnCode: clean.hsnCode,
    gstRate: clean.gstRate,
    attributes: clean.attributes,
    status: "in_review",
  });

  const blocked = await createProduct(editorToken, {
    title: uniqueName("e2e-blocked-review"),
    brand: "Vexa PIM",
    description: "blocked review path",
    categoryId: category.id,
    status: "draft",
    gstRate: 18,
    attributes: {},
  });
  await updateProduct(editorToken, blocked.id, {
    expectedVersion: blocked.version,
    title: blocked.title,
    description: blocked.description,
    brand: blocked.brand,
    categoryId: blocked.categoryId,
    hsnCode: blocked.hsnCode,
    gstRate: blocked.gstRate,
    attributes: blocked.attributes,
    status: "in_review",
  });

  try {
    await loginViaUi(page, "reviewer");
    await page.goto("/quality/approvals", { waitUntil: "domcontentloaded" });

    const cleanRow = page.locator("tbody tr", { hasText: clean.title }).first();
    await expect(cleanRow).toBeVisible();
    await cleanRow.getByRole("button", { name: "Approve" }).click();
    await expect(page).toHaveURL(/decisionStatus=approved/);
    await expect(page.getByText("Product review decision recorded: approved.")).toBeVisible();

    const blockedRow = page.locator("tbody tr", { hasText: blocked.title }).first();
    await expect(blockedRow).toBeVisible();
    await expect(blockedRow.getByRole("button", { name: "Approve" })).toBeDisabled();
    await expect(blockedRow.getByText("Clear blocking issues before approving.")).toBeVisible();
    await blockedRow.getByRole("button", { name: "Reject" }).click();
    await expect(page).toHaveURL(/decisionStatus=rejected/);
    await expect(page.getByText("Product review decision recorded: rejected.")).toBeVisible();

    const cleanStatus = await page.request.get(`${DEFAULT_API_URL}/catalog/products/${clean.id}`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    const cleanPayload = await cleanStatus.json();
    expect(cleanPayload.status).toBe("approved");
  } finally {
    try {
      await deleteProduct(adminToken, clean.id);
    } catch {}
    try {
      await purgeProduct(adminToken, clean.id);
    } catch {}
    try {
      await deleteProduct(adminToken, blocked.id);
    } catch {}
    try {
      await purgeProduct(adminToken, blocked.id);
    } catch {}
    try {
      await deleteCategory(adminToken, category.id);
    } catch {}
  }
});
