const { test, expect } = require("@playwright/test");
const {
  apiLogin,
  createCategory,
  deleteCategory,
  loginViaUi,
  uniqueName,
} = require("./helpers/pim1.cjs");

test("admin can filter audit events and export csv from the audit explorer", async ({ page }) => {
  const adminToken = await apiLogin("admin");
  const category = await createCategory(adminToken, uniqueName("e2e-audit-category"));

  try {
    await loginViaUi(page, "admin");
    await page.goto("/admin/audit?entityType=category&action=POST&actorId=admin@tej-pim.local&limit=25", {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByRole("heading", { name: "Audit Logs" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Apply filters" })).toBeVisible();
    await expect(page.getByText(category.id)).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "Export CSV" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain("tej-pim-audit-events-");
  } finally {
    try {
      await deleteCategory(adminToken, category.id);
    } catch {}
  }
});
