const fs = require("node:fs");
const { test, expect } = require("@playwright/test");
const {
  apiLogin,
  apiRequest,
  createCategory,
  deleteCategory,
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

const REQUIRED_HEADERS = [
  "runId",
  "jobId",
  "rowNumber",
  "skuCode",
  "status",
  "errorCode",
  "errorMessage",
  "attemptCount",
  "originalData",
];

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}

function collectRuntimeErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => {
    errors.push(`pageerror: ${error.stack || error.message || String(error)}`);
  });
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) {
      const text = message.text();
      if (/hydration|react #|parentNode|failed to load|error/i.test(text)) {
        errors.push(`console ${message.type()}: ${text}`);
      }
    }
  });
  return errors;
}

async function waitForJobResult(token, jobId) {
  return expect
    .poll(async () => {
      const job = await apiRequest("GET", `/bulk-import/jobs/${encodeURIComponent(jobId)}`, token);
      return `${job.status}:${job.successRows}:${job.failedRows}:${job.deadLetterRows}`;
    }, { timeout: 45_000 })
    .toBe("dead_letter:1:1:0");
}

async function downloadCsv(page, linkName) {
  const responses = [];
  const responseListener = async (response) => {
    if (response.url().includes("/api/bulk-import/") && response.url().includes("/error-report")) {
      responses.push({
        url: response.url(),
        status: response.status(),
        contentType: response.headers()["content-type"] || "",
        contentDisposition: response.headers()["content-disposition"] || "",
        body: await response.text().catch(() => ""),
      });
    }
  };
  page.on("response", responseListener);
  try {
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("link", { name: linkName }).click(),
    ]);
    const path = await download.path();
    const body = path ? fs.readFileSync(path, "utf8") : "";
    await page.waitForTimeout(300);
    const response = responses[responses.length - 1] || null;
    const verificationResponse = response?.url ? await page.request.get(response.url) : null;
    const verificationBody = verificationResponse ? await verificationResponse.text() : "";
    return {
      suggestedFilename: download.suggestedFilename(),
      body,
      response,
      verification: verificationResponse
        ? {
            status: verificationResponse.status(),
            contentType: verificationResponse.headers()["content-type"] || "",
            contentDisposition: verificationResponse.headers()["content-disposition"] || "",
            body: verificationBody,
          }
        : null,
    };
  } finally {
    page.off("response", responseListener);
  }
}

async function verifyResultPage(page, url, expected) {
  const response = await page.goto(url, { waitUntil: "domcontentloaded" });
  expect(response?.status()).toBe(200);
  await expect(page.getByText(`${expected.problemRows} rows need repair`).first()).toBeVisible();
  await expect(page.getByText("Some rows could not be imported. Successful rows are already available in the catalog.").first()).toBeVisible();
  await expect(page.getByText("Successful rows", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Failed rows", { exact: true }).first()).toBeVisible();
  await expect(page.locator("tbody tr", { hasText: expected.failedSku })).toHaveCount(0);
  await expect(page.locator("tbody tr", { hasText: "Import failed" })).toBeVisible();
  await expect(page.getByText("Invalid status transition").first()).toBeVisible();
}

function assertCsv(download, expected) {
  expect(download.body.length).toBeGreaterThan(0);
  const lines = download.body.trim().split(/\r?\n/);
  expect(lines.length).toBe(2);
  expect(parseCsvLine(lines[0])).toEqual(REQUIRED_HEADERS);
  expect(download.body).toContain(expected.runId);
  expect(download.body).toContain(expected.jobId);
  expect(download.body).toContain(expected.failedSku);
  expect(download.body).toContain("WORKFLOW_ENTRY_INVALID");
  expect(download.body).toContain("Imported rows must enter workflow in draft status.");
  expect(download.body).not.toContain(expected.successSku);
  return lines.slice(0, 3);
}

test("bulk import failed-row export downloads visible problem rows for legacy job and run links", async ({ page }) => {
  test.setTimeout(120_000);
  const adminToken = await apiLogin("admin");
  const category = await createCategory(adminToken, uniqueName("failed-export-cat"));
  const successSku = uniqueName("BULK-EXPORT-OK").toUpperCase();
  const failedSku = uniqueName("BULK-EXPORT-BAD").toUpperCase();
  const sourceRows = [
    {
      title: uniqueName("bulk-export-success"),
      description: "successful import row",
      brand: "Vexa PIM",
      hsnCode: "62046200",
      gstRate: 18,
      status: "draft",
      attributes: { sku: successSku },
    },
    {
      title: uniqueName("bulk-export-failed"),
      description: "failed import row",
      brand: "Vexa PIM",
      hsnCode: "62046200",
      gstRate: 18,
      status: "approved",
      attributes: { sku: failedSku },
    },
  ];
  let createdProductId = null;

  const errors = collectRuntimeErrors(page);

  try {
    const run = await apiRequest("POST", "/bulk-import/runs", adminToken, {
      categoryId: category.id,
      sourceFormat: "csv",
      sourceName: `${uniqueName("failed-export-run")}.csv`,
      rows: sourceRows,
      chunkSize: 1,
      maxRetries: 1,
    });
    await apiRequest("POST", `/bulk-import/runs/${encodeURIComponent(run.id)}/validate`, adminToken);

    const job = await apiRequest("POST", "/bulk-import/jobs", adminToken, {
      categoryId: category.id,
      runId: run.id,
      sourceFormat: "json",
      sourceName: `${uniqueName("failed-export-job")}.json`,
      rows: sourceRows,
      mapping: DEFAULT_MAPPING,
      chunkSize: 1,
      maxRetries: 1,
    });
    await apiRequest("POST", `/bulk-import/jobs/${encodeURIComponent(job.id)}/process`, adminToken, { chunkSize: 1 });
    await waitForJobResult(adminToken, job.id);

    const rows = await apiRequest("GET", `/bulk-import/jobs/${encodeURIComponent(job.id)}/rows?limit=20`, adminToken);
    const successRow = rows.find((row) => row.status === "success");
    createdProductId = successRow?.productId || null;

    await loginViaUi(page, "admin");

    const jobUrl = `/operations/imports?bulkJobId=${encodeURIComponent(job.id)}`;
    await verifyResultPage(page, jobUrl, { problemRows: 1, failedSku });
    const jobFailedRowsDownload = await downloadCsv(page, "Download failed rows CSV");
    const jobFailedRowsSample = assertCsv(jobFailedRowsDownload, {
      runId: run.id,
      jobId: job.id,
      failedSku,
      successSku,
    });
    const jobErrorReportDownload = await downloadCsv(page, "Download error report");
    const jobErrorReportSample = assertCsv(jobErrorReportDownload, {
      runId: run.id,
      jobId: job.id,
      failedSku,
      successSku,
    });

    const runUrl = `/operations/imports?bulkRunId=${encodeURIComponent(run.id)}`;
    await verifyResultPage(page, runUrl, { problemRows: 1, failedSku });
    const runFailedRowsDownload = await downloadCsv(page, "Download failed rows CSV");
    const runFailedRowsSample = assertCsv(runFailedRowsDownload, {
      runId: run.id,
      jobId: job.id,
      failedSku,
      successSku,
    });
    const runErrorReportDownload = await downloadCsv(page, "Download combined error report");
    const runErrorReportSample = assertCsv(runErrorReportDownload, {
      runId: run.id,
      jobId: job.id,
      failedSku,
      successSku,
    });

    for (const download of [jobFailedRowsDownload, jobErrorReportDownload, runFailedRowsDownload, runErrorReportDownload]) {
      expect(download.response?.status).toBe(200);
      expect(download.response?.contentType).toContain("text/csv");
      expect(download.response?.contentDisposition).toContain("attachment");
      expect(download.verification?.status).toBe(200);
      expect(download.verification?.body.length).toBeGreaterThan(0);
      expect(download.verification?.contentType).toContain("text/csv");
      expect(download.verification?.contentDisposition).toContain("attachment");
      expect(download.body).not.toMatch(/<!doctype html|<html/i);
    }

    expect(errors).toEqual([]);

    console.log(JSON.stringify({
      jobUrl,
      runUrl,
      jobId: job.id,
      runId: run.id,
      jobFailedRowsSample,
      jobErrorReportSample,
      runFailedRowsSample,
      runErrorReportSample,
      jobFailedRowsFilename: jobFailedRowsDownload.suggestedFilename,
      runFailedRowsFilename: runFailedRowsDownload.suggestedFilename,
    }, null, 2));
  } finally {
    if (createdProductId) {
      try {
        await deleteProduct(adminToken, createdProductId);
      } catch {}
      try {
        await purgeProduct(adminToken, createdProductId);
      } catch {}
    }
    try {
      await deleteCategory(adminToken, category.id);
    } catch {}
  }
});
