const { test, expect } = require("@playwright/test");
const {
  DEFAULT_API_URL,
  apiLogin,
  apiRequest,
  createCategory,
  loginViaUi,
  uniqueName,
} = require("./helpers/vexa-pim.cjs");

async function resolveCategoryContext(adminToken, token) {
  const categories = await apiRequest("GET", "/taxonomy/categories?all=true", token);
  if (Array.isArray(categories) && categories.length > 0 && categories[0]?.id) {
    return { id: categories[0].id, created: false };
  }
  const category = await createCategory(adminToken, uniqueName("e2e-large-import-cat"));
  return { id: category.id, created: true };
}

async function uploadLargeImportRun(token, categoryId, csvText) {
  const form = new FormData();
  form.set("categoryId", categoryId);
  form.set("maxRetries", "1");
  form.set("sourceFile", new Blob([csvText], { type: "text/csv" }), "TEST-large-import.csv");
  const response = await fetch(`${DEFAULT_API_URL}/bulk-import/runs/upload`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: form,
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Large import run upload failed: ${response.status}; payload=${JSON.stringify(payload)}`);
  }
  return payload;
}

function buildBlockedLargeCsv(rowCount) {
  const lines = ["title,description,brand,hsnCode,gstRate,attributes"];
  for (let index = 0; index < rowCount; index += 1) {
    lines.push(`,"TEST blocked large import ${index}","Vexa PIM","62046200",18,"{}"`);
  }
  return lines.join("\n");
}

test("editor can open a preflight-blocked large import run and see parent-run guidance", async ({ page }) => {
  const adminToken = await apiLogin("admin");
  const editorToken = await apiLogin("editor");
  const category = await resolveCategoryContext(adminToken, editorToken);
  const blockedCsv = buildBlockedLargeCsv(10_001);

  try {
    const run = await uploadLargeImportRun(editorToken, category.id, blockedCsv);
    const validatedRun = await apiRequest("POST", `/bulk-import/runs/${run.id}/validate`, editorToken);

    expect(validatedRun.id).toBe(run.id);
    expect(validatedRun.effectiveMode).toBe("large");
    expect(String(validatedRun.status).toLowerCase()).toBe("preflight_blocked");
    expect(Number(validatedRun.totalRows)).toBe(10_001);

    await loginViaUi(page, "editor");
    await page.goto(`/operations/imports?bulkRunId=${encodeURIComponent(run.id)}`, {
      waitUntil: "domcontentloaded",
    });

    await expect(page.getByRole("heading", { name: `Large Import Run (${run.id})` })).toBeVisible();
    await expect(page.getByText("Large file mode enabled. Vexa will process this file in safe background batches.")).toBeVisible();
    await expect(page.getByText("Preflight blocked this large import run before batch processing started.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Download combined error report" })).toBeVisible();
    await expect(page.getByRole("heading", { name: `Unified Row Repair Console (${run.id})` })).toBeVisible();
    await expect(page.getByText("No rows require repair for this large import run.")).toBeVisible();
  } finally {
    if (category.created) {
      // Large import runs hold a category foreign key, so test-created categories are left in place.
    }
  }
});
