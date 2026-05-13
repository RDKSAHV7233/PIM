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

async function waitForSubmission(token, productId, connectorSlug, maxAttempts = 10) {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const submissions = await apiRequest("GET", `/submissions?connectorSlug=${encodeURIComponent(connectorSlug)}`, token);
    const match = Array.isArray(submissions)
      ? submissions.find((item) => String(item.productId) === String(productId))
      : null;
    if (match) {
      return match;
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`Timed out waiting for submission for product ${productId}`);
}

test("admin can drill from connector portfolio into connector detail and linked product", async ({ page }) => {
  const adminToken = await apiLogin("admin");
  const accountAlias = uniqueName("e2e-fk-account").toLowerCase();
  const category = await createCategory(adminToken, uniqueName("e2e-channels-cat"));
  const product = await createProduct(adminToken, {
    title: uniqueName("e2e-channel-product"),
    brand: "Vexa PIM",
    description: "submission drilldown",
    categoryId: category.id,
    status: "draft",
    attributes: {},
  });

  let installation = null;

  try {
    installation = await apiRequest("POST", "/connectors/flipkart/install", adminToken, {
      accountAlias,
    });

    const exportJob = await apiRequest(
      "POST",
      `/marketplace/products/${product.id}/export-jobs`,
      adminToken,
      {
        channel: "flipkart",
        maxRetries: 1,
      },
    );
    await apiRequest("POST", `/marketplace/export-jobs/${exportJob.id}/process`, adminToken);
    await waitForSubmission(adminToken, product.id, "flipkart");

    await loginViaUi(page, "admin");
    await page.goto("/channels", { waitUntil: "domcontentloaded" });
    await page.getByRole("link", { name: "Open connections" }).click();
    await page.waitForURL(/\/channels\/connectors$/);

    await page.getByRole("textbox", { name: /Search connection/i }).fill(accountAlias);
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(accountAlias).replace(/%/g, "%25")}|q=${accountAlias}`));

    const installationHeading = page.getByRole("heading", { name: `Flipkart / ${accountAlias}` });
    const installationSection = page.locator("section").filter({ has: installationHeading }).first();
    await expect(installationSection).toBeVisible();
    await installationSection.getByRole("link", { name: "Details" }).click();

    await page.waitForURL(new RegExp(`/channels/connectors/${installation.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    await expect(page.getByRole("heading", { name: `Flipkart / ${accountAlias}` })).toBeVisible();
    await expect(page.getByText("Account alias")).toBeVisible();
    await expect(page.getByText(accountAlias, { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Review catalog coverage" }).click();
    await page.waitForURL(
      new RegExp(`/channels/connectors/${installation.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\?tab=catalog$`),
    );
    await expect(page.getByRole("heading", { name: "Catalog Module Framework" })).toBeVisible();

    const submissionRow = page.locator("tbody tr", { hasText: product.id }).first();
    await expect(submissionRow).toBeVisible();
    await submissionRow.getByRole("link", { name: product.title }).click();

    await page.waitForURL(new RegExp(`/products/${product.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`));
    await expect(page.getByRole("heading", { name: product.title })).toBeVisible();
  } finally {
    if (installation?.id) {
      try {
        await apiRequest("POST", `/connectors/${installation.id}/uninstall`, adminToken, {});
      } catch {}
      try {
        await apiRequest("DELETE", `/connectors/flipkart/install/${installation.id}`, adminToken);
      } catch {}
    }
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
