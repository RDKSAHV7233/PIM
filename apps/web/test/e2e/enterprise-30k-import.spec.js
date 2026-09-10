const { test, expect } = require("@playwright/test");
const { apiLogin, apiRequest, createCategory, loginViaUi, uniqueName } = require("./helpers/vexa-pim.cjs");

test.describe.configure({ timeout: 180000 });

function buildCsv(rowCount) {
  const lines = ["title,description,brand,hsnCode,gstRate,attributes"];
  for (let index = 0; index < rowCount; index += 1) {
    lines.push("Enterprise " + index + ",Description " + index + ",Vexa PIM,62046200,18,{}");
  }
  return lines.join("\n");
}

test("editor can validate and start a 30000-row large import", async ({ page }) => {
  const adminToken = await apiLogin("admin");
  const editorToken = await apiLogin("editor");
  const categories = await apiRequest("GET", "/taxonomy/categories?all=true", editorToken);
  const category = Array.isArray(categories) && categories.length > 0 && categories[0]?.id
    ? { id: categories[0].id, created: false }
    : { id: (await createCategory(adminToken, uniqueName("e2e-enterprise-import-cat"))).id, created: true };
  const csvText = buildCsv(30000);

  await loginViaUi(page, "editor");
  await page.goto("/operations/imports?hideTestData=false", { waitUntil: "domcontentloaded" });
  await page.locator('select[name="categoryId"]').selectOption(category.id);
  await page.locator('input[name="sourceFile"]').setInputFiles({
    name: "enterprise-30000.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csvText, "utf8"),
  });

  const uploadForm = page.locator("form", { has: page.locator('input[name="sourceFile"]') }).first();
  await uploadForm.locator('button[type="button"]', { hasText: "Validate file" }).click();
  await expect(page.getByText("Preflight passed")).toBeVisible({ timeout: 120000 });
  await expect(page.getByText("Large import mode")).toBeVisible({ timeout: 10000 });
  await expect(uploadForm.getByRole("button", { name: "Start validated import" })).toBeEnabled({ timeout: 120000 });

  await uploadForm.getByRole("button", { name: "Start validated import" }).click();
  await expect(page).toHaveURL(/bulkRunId=/, { timeout: 120000 });
  const bulkRunId = new URL(page.url()).searchParams.get("bulkRunId");
  expect(bulkRunId).toBeTruthy();
  await expect.poll(async () => {
    const run = await apiRequest("GET", `/bulk-import/runs/${bulkRunId}`, editorToken);
    return String(run.status ?? "").toLowerCase();
  }, { timeout: 30000 }).not.toBe("preflight_ready");
});

test("standard import (under 10k rows) uses standard mode button", async ({ page }) => {
  const adminToken = await apiLogin("admin");
  const editorToken = await apiLogin("editor");
  const categories = await apiRequest("GET", "/taxonomy/categories?all=true", editorToken);
  const category = Array.isArray(categories) && categories.length > 0 && categories[0]?.id
    ? { id: categories[0].id, created: false }
    : { id: (await createCategory(adminToken, uniqueName("e2e-standard-import-cat"))).id, created: true };
  const csvText = buildCsv(100);

  await loginViaUi(page, "editor");
  await page.goto("/operations/imports?hideTestData=false", { waitUntil: "domcontentloaded" });
  await page.locator('select[name="categoryId"]').selectOption(category.id);
  await page.locator('input[name="sourceFile"]').setInputFiles({
    name: "standard-100.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csvText, "utf8"),
  });

  const uploadForm = page.locator("form", { has: page.locator('input[name="sourceFile"]') }).first();
  await uploadForm.locator('button[type="button"]', { hasText: "Validate file" }).click();
  await expect(page.getByText("Preflight passed")).toBeVisible({ timeout: 60000 });
  await expect(uploadForm.getByRole("button", { name: "Start validated import" })).toBeEnabled({ timeout: 60000 });
});
