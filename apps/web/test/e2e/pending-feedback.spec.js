const { test, expect } = require("@playwright/test");
const {
  apiLogin,
  apiRequest,
  loginViaUi,
  uniqueName,
} = require("./helpers/pim1.cjs");

const DEFAULT_MAPPING = {
  title: "title",
  description: "description",
  brand: "brand",
  hsnCode: "hsnCode",
  gstRate: "gstRate",
  status: "status",
  attributes: "attributes",
};

async function delayNextPost(page, delayMs = 1200) {
  let delayed = false;
  const handler = async (route) => {
    const request = route.request();
    if (!delayed && request.method() === "POST") {
      delayed = true;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    await route.continue();
  };
  await page.route("**/*", handler);
}

async function resolveCategoryId(token) {
  const categories = await apiRequest("GET", "/taxonomy/categories?all=true", token);
  if (!Array.isArray(categories) || categories.length === 0 || !categories[0]?.id) {
    throw new Error("Pending feedback e2e requires at least one category in the default workspace.");
  }
  return categories[0].id;
}

test("editor sees pending feedback while uploading and starting an import", async ({ page }) => {
  const editorToken = await apiLogin("editor");
  const categoryId = await resolveCategoryId(editorToken);

  await loginViaUi(page, "editor");
  await page.goto("/operations/imports", { waitUntil: "domcontentloaded" });

  const uploadForm = page.locator("form", {
    has: page.locator('input[name="sourceFile"]'),
  }).first();
  const uploadButton = uploadForm.locator('button[type="submit"]').first();
  const startButtonLabel = "Starting import...";
  const uploadRows = [
    "title,description,brand,hsnCode,gstRate,status,attributes",
    `"${uniqueName("e2e-pending-upload")}","upload pending proof","TEJ PIM","62046200",18,"draft","{}"`,
  ].join("\n");

  await page.locator('select[name="categoryId"]').selectOption(categoryId);
  await page.locator('input[name="sourceFile"]').setInputFiles({
    name: "pending-feedback.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(uploadRows, "utf8"),
  });

  await delayNextPost(page);
  const uploadClick = uploadButton.click();
  await expect(uploadButton).toHaveText("Uploading and starting import...");
  await expect(uploadButton).toBeDisabled();
  await uploadClick;
  await expect(page).toHaveURL(/bulkJobId=/);

  const uploadedJobId = new URL(page.url()).searchParams.get("bulkJobId");
  expect(uploadedJobId).toBeTruthy();
  await expect.poll(async () => {
    const job = await apiRequest("GET", `/bulk-import/jobs/${uploadedJobId}`, editorToken);
    return String(job.status ?? "").toLowerCase();
  }).not.toBe("queued");

  const queuedJob = await apiRequest("POST", "/bulk-import/jobs", editorToken, {
    categoryId,
    sourceFormat: "json",
    sourceName: "pending-feedback.json",
    rows: [
      {
        title: uniqueName("e2e-pending-start"),
        description: "start pending proof",
        brand: "TEJ PIM",
        hsnCode: "62046200",
        gstRate: 18,
        status: "draft",
        attributes: {},
      },
    ],
    mapping: DEFAULT_MAPPING,
    chunkSize: 1,
    maxRetries: 1,
  });

  await page.goto(`/operations/imports?bulkJobId=${queuedJob.id}`, { waitUntil: "domcontentloaded" });
  const queuedRow = page.locator("tbody tr", { hasText: queuedJob.id }).first();
  const startButton = queuedRow.locator('button[type="submit"]').first();
  await expect(startButton).toBeVisible();

  await delayNextPost(page);
  const startClick = startButton.click();
  await expect(startButton).toHaveText(startButtonLabel);
  await expect(startButton).toBeDisabled();
  await startClick;
  await expect(page).toHaveURL(new RegExp(`bulkJobId=${queuedJob.id}`));

  await expect.poll(async () => {
    const job = await apiRequest("GET", `/bulk-import/jobs/${queuedJob.id}`, editorToken);
    return String(job.status ?? "").toLowerCase();
  }).not.toBe("queued");
});
