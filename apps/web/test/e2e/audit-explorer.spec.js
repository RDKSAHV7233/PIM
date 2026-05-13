const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const {
  apiLogin,
  createCategory,
  deleteCategory,
  loginViaUi,
  uniqueName,
} = require("./helpers/vexa-pim.cjs");

test("admin can filter audit events and export csv from the audit explorer", async ({ page }) => {
  const adminToken = await apiLogin("admin");
  const category = await createCategory(adminToken, uniqueName("e2e-audit-category"));
  let downloadDir = null;

  try {
    await loginViaUi(page, "admin");
    await page.goto(
      `/admin/audit?entityType=category&action=POST&actorId=admin@vexa-pim.local&limit=25`,
      { waitUntil: "domcontentloaded" },
    );

    await expect(page.getByRole("heading", { name: "Audit Logs" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Apply filters" })).toBeVisible();
    await expect(page.locator('select[name="entityType"]')).toHaveValue("category");
    await expect(page.locator('select[name="action"]')).toHaveValue("POST");
    await expect(page.locator('input[name="actorId"]')).toHaveValue("admin@vexa-pim.local");
    await expect(page.getByText(category.id, { exact: false }).first()).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: "Export CSV" }).click(),
    ]);
    expect(download.suggestedFilename()).toContain("vexa-pim-audit-events-");

    downloadDir = fs.mkdtempSync(path.join(os.tmpdir(), "vexa-pim-audit-explorer-"));
    const downloadPath = path.join(downloadDir, download.suggestedFilename());
    await download.saveAs(downloadPath);

    const csv = fs.readFileSync(downloadPath, "utf8");
    expect(csv).toContain("category");
    expect(csv).toContain("POST");
    expect(csv).toContain(category.id);
  } finally {
    if (downloadDir && fs.existsSync(downloadDir)) {
      fs.rmSync(downloadDir, { recursive: true, force: true });
    }
    try {
      await deleteCategory(adminToken, category.id);
    } catch {}
  }
});
