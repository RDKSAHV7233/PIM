const { test, expect } = require("@playwright/test");
const {
  apiLogin,
  apiRequest,
  createCategory,
  deleteCategory,
  loginViaUi,
  uniqueName,
} = require("./helpers/vexa-pim.cjs");

const DEFAULT_MAPPING = {
  title: "title",
  description: "description",
  brand: "brand",
  hsnCode: "hsnCode",
  gstRate: "gstRate",
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

async function resolveCategoryContext(adminToken, token) {
  const categories = await apiRequest("GET", "/taxonomy/categories?all=true", token);
  if (Array.isArray(categories) && categories.length > 0 && categories[0]?.id) {
    return { id: categories[0].id, created: false };
  }
  const category = await createCategory(adminToken, uniqueName("e2e-pending-feedback-cat"));
  return { id: category.id, created: true };
}

test("editor sees pending feedback while uploading and starting an import", async ({ page }) => {
  let adminToken;
  let editorToken;
  let category;

  await test.step("Setup: authenticate admin and editor", async () => {
    adminToken = await apiLogin("admin");
    editorToken = await apiLogin("editor");
    category = await resolveCategoryContext(adminToken, editorToken);
  });

  const categoryId = category.id;

  try {
    await test.step("Navigate to imports page", async () => {
      await loginViaUi(page, "editor");
      await page.goto("/operations/imports?hideTestData=false", { waitUntil: "domcontentloaded" });
    });

    const uploadForm = page.locator("form", {
      has: page.locator('input[name="sourceFile"]'),
    }).first();
    const uploadButton = uploadForm.locator('button[type="submit"]').first();
    const startButtonLabel = "Starting import...";

    await test.step("Fill upload form — select category and CSV file", async () => {
      const uploadRows = [
        "title,description,brand,hsnCode,gstRate,attributes",
        `"${uniqueName("e2e-pending-upload")}","upload pending proof","Vexa PIM","62046200",18,"{}"`,
      ].join("\n");

      await page.locator('select[name="categoryId"]').selectOption(categoryId);
      await page.locator('input[name="sourceFile"]').setInputFiles({
        name: "pending-feedback.csv",
        mimeType: "text/csv",
        buffer: Buffer.from(uploadRows, "utf8"),
      });
    });

    await test.step("Validate CSV file before import", async () => {
      const validateButton = uploadForm.locator('button[type="button"]', { hasText: /Validate file/ });
      await validateButton.click();
      await expect(uploadButton).toHaveText("Start validated import", { timeout: 30000 });
    });

    await test.step("Upload CSV and assert pending feedback on button", async () => {
      await delayNextPost(page);
      const uploadClick = uploadButton.click();
      await expect(uploadButton).toHaveText("Uploading and starting import...");
      await expect(uploadButton).toBeDisabled();
      await uploadClick;
    });

    await test.step("Assert upload completes and URL has bulkJobId", async () => {
      await expect(page).toHaveURL(/bulkJobId=/, { timeout: 30000 });
      const uploadedJobId = new URL(page.url()).searchParams.get("bulkJobId");
      expect(uploadedJobId).toBeTruthy();
      await expect.poll(async () => {
        const job = await apiRequest("GET", `/bulk-import/jobs/${uploadedJobId}`, editorToken);
        return String(job.status ?? "").toLowerCase();
      }, { timeout: 30000 }).not.toBe("queued");
    });

    let queuedJob;
    await test.step("Create second queued job via API", async () => {
      queuedJob = await apiRequest("POST", "/bulk-import/jobs", editorToken, {
        categoryId,
        sourceFormat: "json",
        sourceName: "pending-feedback.json",
        rows: [
          {
            title: uniqueName("e2e-pending-start"),
            description: "start pending proof",
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
    });

    let startButton;
    await test.step("Navigate to queued job row", async () => {
      await page.goto(`/operations/imports?bulkJobId=${queuedJob.id}&hideTestData=false`, { waitUntil: "domcontentloaded" });
      const queuedRow = page.locator("tbody tr", { hasText: queuedJob.id }).first();
      startButton = queuedRow.locator('button[type="submit"]').first();
      await expect(startButton).toBeVisible();
    });

    await test.step("Start import and assert pending feedback on button", async () => {
      await delayNextPost(page);
      const startClick = startButton.click();
      await expect(startButton).toHaveText(startButtonLabel);
      await expect(startButton).toBeDisabled();
      await startClick;
    });

    await test.step("Assert import started and job leaves queued state", async () => {
      await expect(page).toHaveURL(new RegExp(`bulkJobId=${queuedJob.id}`));
      await expect.poll(async () => {
        const job = await apiRequest("GET", `/bulk-import/jobs/${queuedJob.id}`, editorToken);
        return String(job.status ?? "").toLowerCase();
      }, { timeout: 30000 }).not.toBe("queued");
    });
  } finally {
    if (category.created) {
      try {
        await deleteCategory(adminToken, category.id);
      } catch {}
    }
  }
});
