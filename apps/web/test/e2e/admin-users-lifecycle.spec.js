const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { PrismaClient } = require("@prisma/client");
const { apiLoginPayload, apiRequest, loginViaUi } = require("./helpers/vexa-pim.cjs");

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

async function cleanupTempWorkspaceUser(tenantKey, userId) {
  const prisma = createPrismaClient();
  try {
    await prisma.connectorPermission.deleteMany({
      where: {
        tenantKey,
        principalId: userId,
      },
    });
    await prisma.userNotification.deleteMany({
      where: {
        tenantKey,
        userId,
      },
    });
    await prisma.authRecoveryToken.deleteMany({
      where: {
        tenantKey,
        userId,
      },
    });
    await prisma.accountConsentEvent.deleteMany({
      where: {
        tenantKey,
        userId,
      },
    });
    await prisma.accountExportRequest.deleteMany({
      where: {
        tenantKey,
        userId,
      },
    });
    await prisma.accountDeletionRequest.deleteMany({
      where: {
        tenantKey,
        userId,
      },
    });
    await prisma.authIdentity.deleteMany({
      where: {
        tenantKey,
        userId,
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}

test("admin can manage a workspace user lifecycle from the browser", async ({ page }) => {
  const adminAuth = await apiLoginPayload("admin");
  test.skip(adminAuth.role !== "admin", `admin identity resolves as ${adminAuth.role} in current local environment`);

  const adminToken = adminAuth.accessToken;
  const tenantKey = String(adminAuth.tenantId || "default");
  const tempUserId = `pw-user-${Date.now()}@example.com`;

  const row = () => page.locator("tbody tr", { hasText: tempUserId }).first();

  try {
    await loginViaUi(page, "admin");
    await page.goto("/admin/users", { waitUntil: "domcontentloaded" });

    await page.getByRole("link", { name: "Invite User" }).click();
    await page.waitForURL(/showInvite=true/);

    await page.getByLabel("User ID").fill(tempUserId);
    await page.getByLabel("Role").selectOption("viewer");
    await page.getByRole("button", { name: "Create User" }).click();

    await page.waitForURL(/status=user-created/);
    await expect(page.getByText("Workspace user invited.")).toBeVisible();
    await expect(row()).toBeVisible();
    await expect(row()).toContainText("active");

    const initialUsers = await apiRequest("GET", "/admin/workspace/users", adminToken);
    const createdUser = initialUsers.find((entry) => entry.userId === tempUserId);
    expect(createdUser).toBeTruthy();
    expect(createdUser.role).toBe("viewer");

    await row().locator('select[name="role"]').selectOption("reviewer");
    await row().getByRole("button", { name: "Save" }).click();
    await page.waitForURL(/status=role-updated/);
    await expect(page.getByText("Workspace user role updated.")).toBeVisible();
    await expect(row().locator('select[name="role"]')).toHaveValue("reviewer");

    const updatedUsers = await apiRequest("GET", "/admin/workspace/users", adminToken);
    const updatedUser = updatedUsers.find((entry) => entry.userId === tempUserId);
    expect(updatedUser?.role).toBe("reviewer");

    await row().getByRole("button", { name: "Lock 60m" }).click();
    await page.waitForURL(/status=user-locked/);
    await expect(page.getByText("Workspace user locked.")).toBeVisible();
    await expect(row()).toContainText("locked");
    await expect(row().getByRole("button", { name: "Unlock" })).toBeVisible();

    const lockedUsers = await apiRequest("GET", "/admin/workspace/users", adminToken);
    const lockedUser = lockedUsers.find((entry) => entry.userId === tempUserId);
    expect(lockedUser?.isLocked).toBe(true);
    expect(typeof lockedUser?.lockedUntil).toBe("string");

    await row().getByRole("button", { name: "Unlock" }).click();
    await page.waitForURL(/status=user-unlocked/);
    await expect(page.getByText("Workspace user unlocked.")).toBeVisible();
    await expect(row()).toContainText("active");

    const unlockedUsers = await apiRequest("GET", "/admin/workspace/users", adminToken);
    const unlockedUser = unlockedUsers.find((entry) => entry.userId === tempUserId);
    expect(unlockedUser?.isLocked).toBe(false);
    expect(unlockedUser?.role).toBe("reviewer");

    await row().getByRole("button", { name: "Deactivate" }).click();
    await page.waitForURL(/status=user-deactivated/);
    await expect(page.getByText("Workspace user deactivated.")).toBeVisible();
    await expect(row()).toContainText("inactive");

    const deactivatedUsers = await apiRequest("GET", "/admin/workspace/users", adminToken);
    const deactivatedUser = deactivatedUsers.find((entry) => entry.userId === tempUserId);
    expect(deactivatedUser?.isActive).toBe(false);
  } finally {
    try {
      await cleanupTempWorkspaceUser(tenantKey, tempUserId);
    } catch (error) {
      console.error("Workspace user browser flow cleanup failed:", error instanceof Error ? error.message : String(error));
    }
  }
});
