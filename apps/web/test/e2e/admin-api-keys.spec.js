const { test, expect } = require("@playwright/test");
const {
  apiLoginPayload,
  apiRequest,
  createCategory,
  deleteCategory,
  deleteProduct,
  loginViaUi,
  purgeProduct,
  uniqueName,
  DEFAULT_API_URL,
} = require("./helpers/tej-pim.cjs");

async function apiKeyRequest(method, route, apiKey, body) {
  const headers = {
    Accept: "application/json",
    "x-pim-api-key": apiKey,
  };
  const options = {
    method,
    headers,
    signal: AbortSignal.timeout(20_000),
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${DEFAULT_API_URL}${route}`, options);
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return { status: response.status, payload };
}

test("admin can create and revoke an API key from the browser", async ({ page }) => {
  const adminAuth = await apiLoginPayload("admin");
  test.skip(adminAuth.role !== "admin", `admin identity resolves as ${adminAuth.role} in current local environment`);

  const adminToken = adminAuth.accessToken;
  const label = uniqueName("e2e-api-key");
  const productTitle = uniqueName("e2e-api-key-product");

  let createdKeyId = null;
  let plainTextKey = null;
  let category = null;
  let productId = null;

  try {
    await loginViaUi(page, "admin");
    await page.goto("/admin/api-keys", { waitUntil: "domcontentloaded" });

    await page.getByLabel("Label").fill(label);
    await page.getByLabel("Role").selectOption("editor");
    await page.getByRole("button", { name: "Create API key" }).click();

    await expect(page.getByText(`API key created for ${label}. Copy it now; it will not be shown again.`)).toBeVisible();

    plainTextKey = await page.locator("textarea[readonly]").first().inputValue();
    expect(plainTextKey.startsWith("pim1_")).toBeTruthy();

    const keyRow = page.locator("tbody tr", { hasText: label }).first();
    await expect(keyRow).toBeVisible();
    await expect(keyRow).toContainText("active");

    const listedKeys = await apiRequest("GET", "/admin/api-keys", adminToken);
    const createdKey = listedKeys.find((row) => row.label === label);
    expect(createdKey).toBeTruthy();
    createdKeyId = createdKey.id;

    category = await createCategory(adminToken, uniqueName("e2e-api-key-cat"));

    const createWithApiKey = await apiKeyRequest("POST", "/catalog/products", plainTextKey, {
      title: productTitle,
      brand: "Vexa PIM",
      description: "Created with browser-issued API key",
      categoryId: category.id,
      status: "draft",
      hsnCode: "62046200",
      gstRate: 18,
      attributes: {},
    });
    expect(createWithApiKey.status).toBe(201);
    productId = createWithApiKey.payload?.id ?? null;
    expect(productId).toBeTruthy();

    await keyRow.getByRole("button", { name: "Revoke" }).click();
    await page.waitForURL(/\/admin\/api-keys\?status=api-key-revoked/);
    await expect(page.getByText("API key revoked.")).toBeVisible();

    const revokedRow = page.locator("tbody tr", { hasText: label }).first();
    await expect(revokedRow).toContainText("revoked");

    const updatedKeys = await apiRequest("GET", "/admin/api-keys", adminToken);
    const revokedKey = updatedKeys.find((row) => row.id === createdKeyId);
    expect(revokedKey?.revokedAt).toBeTruthy();

    const revokedAttempt = await apiKeyRequest("GET", "/catalog/products", plainTextKey);
    expect(revokedAttempt.status).toBe(401);
    expect(revokedAttempt.payload?.error).toBe("INVALID_API_KEY");
  } finally {
    if (productId) {
      try {
        await deleteProduct(adminToken, productId);
      } catch {}
      try {
        await purgeProduct(adminToken, productId);
      } catch {}
    }
    if (category?.id) {
      try {
        await deleteCategory(adminToken, category.id);
      } catch {}
    }
    if (createdKeyId) {
      try {
        await apiRequest("POST", `/admin/api-keys/${encodeURIComponent(createdKeyId)}/revoke`, adminToken, {});
      } catch {}
    }
  }
});
