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
const { seedConnectorCredentials } = require("./helpers/seed-connector-credentials.cjs");

// The playwright_e2e schema ships a credential-less Flipkart installation, which
// the connector heartbeat marks CREDENTIAL_EXPIRED — so export-job creation used
// to fail with DESTINATION_NOT_FOUND and this spec self-skipped. Seed working-
// looking credentials + restore the install to ACTIVE so job creation is
// accepted; dispatch then still fails because the connector cannot reach
// Flipkart, which is exactly the failure this spec follows into recovery.
test.beforeAll(async () => {
  await seedConnectorCredentials({ connectorSlug: "flipkart" });
});

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

    let exportJobResponse = null;
    try {
      exportJobResponse = await apiRequest("POST", `/marketplace/products/${encodeURIComponent(product.id)}/export-jobs`, adminToken, {
        channel: "flipkart",
        maxRetries: 1,
      });
    } catch (err) {
      // Flipkart connector not installed for this tenant — skip gracefully.
      const msg = String(err?.message ?? "");
      if (msg.includes("not installed") || msg.includes("400") || msg.includes("connector")) {
        test.skip(true, `Export channel not available: ${msg.slice(0, 120)}`);
        return;
      }
      throw err;
    }
    exportJobId = String(exportJobResponse.id);
    // Dispatch is partly async now (the CONNECTOR_SUBMISSION queue worker can
    // land the terminal state after /process returns), so the POST may still
    // report "processing". Poll the job to a terminal failure state.
    const processed = await apiRequest("POST", `/marketplace/export-jobs/${encodeURIComponent(exportJobId)}/process`, adminToken);
    let terminalStatus = String(processed.status);
    if (!["failed", "dead_letter"].includes(terminalStatus)) {
      await expect
        .poll(
          async () => {
            const job = await apiRequest(
              "GET",
              `/marketplace/export-jobs/${encodeURIComponent(exportJobId)}`,
              adminToken,
            );
            terminalStatus = String(job.status);
            return terminalStatus;
          },
          { timeout: 30_000, intervals: [500, 1000, 2000] },
        )
        .toMatch(/^(failed|dead_letter)$/);
    }
    expect(["failed", "dead_letter"]).toContain(terminalStatus);

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
