const { test, expect } = require("@playwright/test");
const {
  createCategory,
  deleteCategory,
  apiLogin,
  apiRequest,
  deleteProduct,
  loginViaUi,
  purgeProduct,
  uniqueName,
} = require("./helpers/vexa-pim.cjs");

const DEFAULT_MAPPING = {
  title: "title",
  description: "description",
  brand: "brand",
  hsnCode: "hsnCode",
  gstRate: "gstRate",
  status: "status",
  attributes: "attributes",
};

async function resolveCategoryContext(adminToken, token) {
  const categories = await apiRequest("GET", "/taxonomy/categories?all=true", token);
  if (Array.isArray(categories) && categories.length > 0 && categories[0]?.id) {
    return { id: categories[0].id, created: false };
  }
  const category = await createCategory(adminToken, uniqueName("e2e-import-repair-cat"));
  return { id: category.id, created: true };
}

async function getRow(token, jobId, rowId) {
  const rows = await apiRequest(
    "GET",
    `/bulk-import/jobs/${encodeURIComponent(jobId)}/rows?limit=20`,
    token,
  );
  if (!Array.isArray(rows)) {
    throw new Error(`Expected bulk import rows array for job ${jobId}.`);
  }
  const row = rows.find((candidate) => String(candidate.id) === String(rowId));
  if (!row) {
    throw new Error(`Could not find row ${rowId} for job ${jobId}.`);
  }
  return row;
}

test("editor can repair a dead-letter import from repair center and clear the backlog", async ({ page }) => {
  const adminToken = await apiLogin("admin");
  const editorToken = await apiLogin("editor");
  const category = await resolveCategoryContext(adminToken, editorToken);
  const categoryId = category.id;
  const repairedTitle = uniqueName("e2e-repaired-import");
  const importJob = await apiRequest("POST", "/bulk-import/jobs", editorToken, {
    categoryId,
    sourceFormat: "json",
    sourceName: `${uniqueName("e2e-import-repair")}.json`,
    rows: [
      {
        title: "",
        description: "repair center journey",
        brand: "Vexa PIM",
        hsnCode: "62046200",
        gstRate: 18,
        attributes: {},
      },
    ],
    mapping: DEFAULT_MAPPING,
    chunkSize: 1,
    maxRetries: 1,
  });
  const jobId = importJob.id;
  const failedRowId = importJob.rows?.[0]?.id;

  if (!jobId || !failedRowId) {
    throw new Error("Bulk import repair e2e requires a created job with one seeded row.");
  }

  let repairedProductId = null;

  try {
    await apiRequest("POST", `/bulk-import/jobs/${encodeURIComponent(jobId)}/process`, editorToken, {
      chunkSize: 1,
    });

    await expect.poll(async () => {
      const job = await apiRequest("GET", `/bulk-import/jobs/${encodeURIComponent(jobId)}`, editorToken);
      return `${job.status}:${job.deadLetterRows}:${job.failedRows}`;
    }).toBe("dead_letter:1:0");

    await loginViaUi(page, "editor");
    await page.goto("/operations/repair", { waitUntil: "domcontentloaded" });

    const failedImportRow = page.locator("li").filter({ hasText: jobId }).first();
    await expect(failedImportRow).toBeVisible();
    await expect(failedImportRow.getByText("1 dead letter")).toBeVisible();
    await failedImportRow.getByRole("link", { name: "Repair" }).click();

    await page.waitForURL(new RegExp(`bulkJobId=${jobId.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}`));
    await expect(
      page.getByRole("heading", { name: new RegExp(`Row Repair Console \\(${jobId}\\)`) }),
    ).toBeVisible();

    await page.getByLabel("title").fill(repairedTitle);
    await page.getByRole("button", { name: "Save and retry this row" }).click();

    await expect.poll(async () => {
      const row = await getRow(editorToken, jobId, failedRowId);
      repairedProductId = row.productId || repairedProductId;
      return row.status;
    }).toBe("success");

    await expect.poll(async () => {
      const job = await apiRequest("GET", `/bulk-import/jobs/${encodeURIComponent(jobId)}`, editorToken);
      return `${job.status}:${job.deadLetterRows}:${job.failedRows}:${job.successRows}`;
    }).toBe("completed:0:0:1");

    await expect(page.getByText("No rows require repair for this import job.")).toBeVisible();

    await page.goto("/operations/repair", { waitUntil: "domcontentloaded" });
    await expect(page.locator("li").filter({ hasText: jobId })).toHaveCount(0);
  } finally {
    if (!repairedProductId) {
      try {
        const row = await getRow(editorToken, jobId, failedRowId);
        repairedProductId = row.productId || null;
      } catch {}
    }
    if (repairedProductId) {
      try {
        await deleteProduct(editorToken, repairedProductId);
      } catch {}
      try {
        await purgeProduct(editorToken, repairedProductId);
      } catch {}
    }
    if (category.created) {
      try {
        await deleteCategory(adminToken, category.id);
      } catch {}
    }
  }
});
