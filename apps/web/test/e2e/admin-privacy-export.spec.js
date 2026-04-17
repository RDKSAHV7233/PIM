const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { PrismaClient } = require("@prisma/client");
const { apiLoginPayload, apiRequest, loginViaUi, DEFAULT_API_URL } = require("./helpers/vexa-pim.cjs");

const REPO_ROOT = path.resolve(__dirname, "../../../..");

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const values = {};
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) {
      continue;
    }
    const idx = line.indexOf("=");
    if (idx === -1) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    const raw = line.slice(idx + 1).trim();
    if (key) {
      values[key] = raw.replace(/^"|"$/g, "");
    }
  }
  return values;
}

function createPrismaClient() {
  const fileEnv = readEnvFile(path.join(REPO_ROOT, ".env"));
  const localDatabaseUrl = "postgresql://postgres:postgres@localhost:5432/pim1?schema=public";
  const resolved =
    String(process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL || fileEnv.DATABASE_URL_POOLED || fileEnv.DATABASE_URL || "").trim();
  const databaseUrl = !resolved || /HOST:5432/i.test(resolved) ? localDatabaseUrl : resolved;
  return new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });
}

async function cleanupAccountExport(tenantKey, jobId) {
  const prisma = createPrismaClient();
  try {
    const exportRow = await prisma.accountExportRequest.findFirst({
      where: {
        tenantKey,
        id: jobId,
      },
      select: {
        artifactPath: true,
      },
    });
    if (exportRow?.artifactPath && path.isAbsolute(exportRow.artifactPath) && fs.existsSync(exportRow.artifactPath)) {
      try {
        await fs.promises.unlink(exportRow.artifactPath);
      } catch {}
    }
    await prisma.accountExportRequest.deleteMany({
      where: {
        tenantKey,
        id: jobId,
      },
    });
    await prisma.auditLog.deleteMany({
      where: {
        tenantKey,
        resourceId: jobId,
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}

test("admin can request and observe an account export from the browser", async ({ page }) => {
  const adminAuth = await apiLoginPayload("admin");
  test.skip(adminAuth.role !== "admin", `admin identity resolves as ${adminAuth.role} in current local environment`);

  const adminToken = adminAuth.accessToken;
  const tenantKey = String(adminAuth.tenantId || "default");
  let exportJobId = null;

  try {
    await loginViaUi(page, "admin");
    await page.goto("/admin/privacy", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Data and Privacy" })).toBeVisible();
    await page.getByLabel("Format").selectOption("csv");

    const exportResponsePromise = page.waitForResponse(
      (response) => response.url().includes("/api/account/export") && response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Request export" }).click();

    const exportResponse = await exportResponsePromise;
    expect(exportResponse.status()).toBe(202);
    const exportPayload = await exportResponse.json();
    exportJobId = String(exportPayload.jobId || "");
    expect(exportJobId.startsWith("exp_")).toBeTruthy();

    await expect(page.getByText(`Export requested (${exportJobId}).`, { exact: false })).toBeVisible();

    await expect
      .poll(async () => {
        const privacyStatus = await apiRequest("GET", "/auth/account/privacy-status", adminToken, undefined, DEFAULT_API_URL);
        const latestExport = privacyStatus.latestExport;
        return latestExport?.jobId === exportJobId ? latestExport.status : "";
      }, { timeout: 30_000 })
      .toBe("completed");

    const latestPrivacyStatus = await apiRequest("GET", "/auth/account/privacy-status", adminToken, undefined, DEFAULT_API_URL);
    expect(latestPrivacyStatus.latestExport?.jobId).toBe(exportJobId);
    expect(latestPrivacyStatus.latestExport?.format).toBe("csv");
    expect(latestPrivacyStatus.latestExport?.downloadAvailable).toBe(true);

    const downloadResponse = await fetch(`${DEFAULT_API_URL}/auth/account/export/${encodeURIComponent(exportJobId)}/download`, {
      method: "GET",
      headers: {
        Accept: "application/octet-stream",
        Authorization: `Bearer ${adminToken}`,
      },
      signal: AbortSignal.timeout(20_000),
    });
    expect(downloadResponse.status).toBe(200);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText("completed (CSV)", { exact: false })).toBeVisible();
    await expect(page.getByRole("link", { name: "Download export" })).toBeVisible();
  } finally {
    if (exportJobId) {
      try {
        await cleanupAccountExport(tenantKey, exportJobId);
      } catch (error) {
        console.error("Privacy export browser flow cleanup failed:", error instanceof Error ? error.message : String(error));
      }
    }
  }
});
