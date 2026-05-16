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

test("editor can filter product list by search term and see matching row", async ({ page }) => {
  const adminToken = await apiLogin("admin");
  const editorToken = await apiLogin("editor");
  const category = await createCategory(adminToken, uniqueName("e2e-lifecycle-filter-cat"));
  const product = await createProduct(editorToken, {
    title: uniqueName("e2e-lifecycle-filter-product"),
    brand: "Vexa PIM",
    description: "product list filter test",
    categoryId: category.id,
    status: "draft",
    hsnCode: "62046200",
    gstRate: 18,
    attributes: {},
  });

  try {
    await loginViaUi(page, "editor");
    await page.goto(
      `/catalog/products?hideTestData=false&search=${encodeURIComponent(product.title)}`,
      { waitUntil: "domcontentloaded" },
    );
    const row = page.locator("tbody tr", { hasText: product.title }).first();
    await expect(row).toBeVisible();
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

test("bulk action bar appears when a product row is selected", async ({ page }) => {
  const adminToken = await apiLogin("admin");
  const editorToken = await apiLogin("editor");
  const category = await createCategory(adminToken, uniqueName("e2e-bulk-action-cat"));
  const product = await createProduct(editorToken, {
    title: uniqueName("e2e-bulk-action-product"),
    brand: "Vexa PIM",
    description: "bulk action bar test",
    categoryId: category.id,
    status: "draft",
    hsnCode: "62046200",
    gstRate: 18,
    attributes: {},
  });

  try {
    await loginViaUi(page, "editor");
    await page.goto(
      `/catalog/products?hideTestData=false&search=${encodeURIComponent(product.title)}`,
      { waitUntil: "domcontentloaded" },
    );
    const row = page.locator("tbody tr", { hasText: product.title }).first();
    await expect(row).toBeVisible();

    const rowCheckbox = row.getByRole("checkbox").first();
    await rowCheckbox.check();

    await expect(
      page.locator('[aria-label*="selected"], [data-testid*="bulk"], [role="toolbar"]').or(
        page.getByText(/selected|bulk action/i),
      ).first(),
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

test("editor can view product detail page with heading and channel readiness section", async ({ page }) => {
  const adminToken = await apiLogin("admin");
  const editorToken = await apiLogin("editor");
  const category = await createCategory(adminToken, uniqueName("e2e-detail-tabs-cat"));
  const product = await createProduct(editorToken, {
    title: uniqueName("e2e-detail-tabs-product"),
    brand: "Vexa PIM",
    description: "product detail tabs check",
    categoryId: category.id,
    status: "draft",
    hsnCode: "62046200",
    gstRate: 18,
    attributes: {},
  });

  try {
    await loginViaUi(page, "editor");
    await page.goto(`/products/${encodeURIComponent(product.id)}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: product.title })).toBeVisible();

    await page.goto(`/products/${encodeURIComponent(product.id)}?tab=channels`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Channel readiness and queued exports" })).toBeVisible();
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

test("editor can request review on a draft product via the product detail page", async ({ page }) => {
  const adminToken = await apiLogin("admin");
  const editorToken = await apiLogin("editor");
  const category = await createCategory(adminToken, uniqueName("e2e-submit-review-cat"));
  const product = await createProduct(editorToken, {
    title: uniqueName("e2e-submit-review-product"),
    brand: "Vexa PIM",
    description: "submit for review flow",
    categoryId: category.id,
    status: "draft",
    hsnCode: "62046200",
    gstRate: 18,
    attributes: {},
  });

  try {
    await loginViaUi(page, "editor");
    await page.goto(`/products/${encodeURIComponent(product.id)}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: product.title })).toBeVisible();

    const reviewButton = page.getByRole("button", { name: /submit for review|request review|move to review/i }).first();
    await reviewButton.click();

    await expect.poll(async () => {
      const response = await page.request.get(`${DEFAULT_API_URL}/catalog/products/${product.id}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        failOnStatusCode: false,
      });
      if (!response.ok()) {
        return "";
      }
      const payload = await response.json();
      return payload.status;
    }, { timeout: 15_000 }).toBe("in_review");
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

test("reviewer sees product detail without write controls", async ({ page }) => {
  const reviewerAuth = await apiLoginPayload("reviewer");
  test.skip(reviewerAuth.role !== "reviewer", `reviewer identity resolves as ${reviewerAuth.role} in current local environment`);
  const adminToken = await apiLogin("admin");
  const category = await createCategory(adminToken, uniqueName("e2e-reviewer-readonly-cat"));
  const product = await createProduct(adminToken, {
    title: uniqueName("e2e-reviewer-readonly-product"),
    brand: "Vexa PIM",
    description: "reviewer read-only check",
    categoryId: category.id,
    status: "draft",
    hsnCode: "62046200",
    gstRate: 18,
    attributes: {},
  });

  try {
    await loginViaUi(page, "reviewer");
    await page.goto(`/products/${encodeURIComponent(product.id)}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: product.title })).toBeVisible();
    await expect(page.getByRole("button", { name: /save product|update product|save changes/i })).toHaveCount(0);
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

test("viewer cannot access write controls on product detail", async ({ page }) => {
  const adminToken = await apiLogin("admin");
  const category = await createCategory(adminToken, uniqueName("e2e-viewer-readonly-cat"));
  const product = await createProduct(adminToken, {
    title: uniqueName("e2e-viewer-readonly-product"),
    brand: "Vexa PIM",
    description: "viewer read-only check",
    categoryId: category.id,
    status: "draft",
    hsnCode: "62046200",
    gstRate: 18,
    attributes: {},
  });

  try {
    await loginViaUi(page, "viewer");
    await page.goto(`/products/${encodeURIComponent(product.id)}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: product.title })).toBeVisible();
    await expect(page.getByRole("button", { name: /save product|update product|save changes/i })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /archive product|delete/i })).toHaveCount(0);
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

test("admin can activate an approved product and see the active status badge", async ({ page }) => {
  const reviewerAuth = await apiLoginPayload("reviewer");
  test.skip(reviewerAuth.role !== "reviewer", `reviewer identity resolves as ${reviewerAuth.role} in current local environment`);
  const adminToken = await apiLogin("admin");
  const editorToken = await apiLogin("editor");
  const reviewerToken = reviewerAuth.accessToken;
  const category = await createCategory(adminToken, uniqueName("e2e-activate-cat"));
  const product = await createProduct(editorToken, {
    title: uniqueName("e2e-activate-product"),
    brand: "Vexa PIM",
    description: "product activation flow",
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
    await fetch(`${DEFAULT_API_URL}/catalog/products/${product.id}/review-decision`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${reviewerToken}`,
      },
      body: JSON.stringify({ status: "approved" }),
      signal: AbortSignal.timeout(20_000),
    });

    await loginViaUi(page, "admin");
    await page.goto(`/products/${encodeURIComponent(product.id)}`, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: product.title })).toBeVisible();

    const activateButton = page.getByRole("button", { name: /activate|set active|mark active/i }).first();
    await activateButton.click();

    await expect.poll(async () => {
      const response = await page.request.get(`${DEFAULT_API_URL}/catalog/products/${product.id}`, {
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      const payload = await response.json();
      return payload.status;
    }, { timeout: 15_000 }).toBe("active");
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
