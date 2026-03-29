const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { PrismaClient } = require("@prisma/client");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const SIGNUP_OUTBOX_DIR = String(process.env.PLAYWRIGHT_SIGNUP_OUTBOX_DIR || "").trim();
const API_URL = String(process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:4001/api/v1").trim();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

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
  const resolved = String(
    process.env.DATABASE_URL_POOLED ||
      process.env.DATABASE_URL ||
      fileEnv.DATABASE_URL_POOLED ||
      fileEnv.DATABASE_URL ||
      "",
  ).trim();
  const databaseUrl = !resolved || /HOST:5432/i.test(resolved) ? localDatabaseUrl : resolved;
  return new PrismaClient({
    datasources: {
      db: {
        url: databaseUrl,
      },
    },
  });
}

function createSignupIdentity() {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const suffix = stamp.slice(-12);
  return {
    displayName: `Playwright Ops ${suffix}`,
    workspaceSlug: `pw-ops-${suffix}`.slice(0, 30),
    adminEmail: `pw-ops-${suffix}@example.com`,
    password: "Ops#2026",
  };
}

async function apiRequest(method, route, token, body) {
  const headers = { Accept: "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const options = {
    method,
    headers,
    signal: AbortSignal.timeout(20_000),
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${API_URL}${route}`, options);
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) {
    throw new Error(`${method} ${route} failed: ${response.status}; payload=${JSON.stringify(payload)}`);
  }
  return payload;
}

async function waitForOutboxEmail(outboxDir, recipient, category, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(outboxDir)) {
      const matches = fs
        .readdirSync(outboxDir)
        .map((file) => {
          const fullPath = path.join(outboxDir, file);
          return {
            file,
            parsed: JSON.parse(fs.readFileSync(fullPath, "utf8")),
          };
        })
        .filter(
          (entry) =>
            String(entry.parsed.to ?? "").trim().toLowerCase() === recipient.toLowerCase() &&
            String(entry.parsed.category ?? "").trim() === category,
        )
        .sort((left, right) => {
          const leftTime = new Date(left.parsed.writtenAt ?? 0).getTime();
          const rightTime = new Date(right.parsed.writtenAt ?? 0).getTime();
          return leftTime - rightTime;
        });
      if (matches.length > 0) {
        return matches[matches.length - 1].parsed;
      }
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${category} email for ${recipient}`);
}

function extractVerificationToken(emailPayload) {
  const source = `${String(emailPayload.text ?? "")}\n${String(emailPayload.html ?? "")}`;
  const match = source.match(/\/signup\/verify\?token=([^&\s\"]+)/i);
  if (!match) {
    throw new Error(`Unable to locate signup verification token in email payload=${JSON.stringify(emailPayload)}`);
  }
  return decodeURIComponent(match[1]);
}

async function loginForWorkspace(workspaceSlug, userId, password) {
  const payload = await apiRequest("POST", "/auth/login", null, {
    workspaceSlug,
    userId,
    password,
    expiresInMinutes: 30,
  });
  return String(payload?.accessToken ?? "");
}

async function loginViaWorkspaceUi(page, workspaceSlug, userId, password) {
  await page.goto("/login", { waitUntil: "domcontentloaded" });
  await page.getByLabel("Workspace").fill(workspaceSlug);
  await page.getByLabel("User ID").fill(userId);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 20_000 });
  await page.getByText("Role: Admin").waitFor({ state: "visible" });
}

async function cleanupSignupWorkspace(workspaceSlug, adminEmail) {
  const prisma = createPrismaClient();
  try {
    await prisma.accountConsentEvent.deleteMany({ where: { tenantKey: workspaceSlug } });
    await prisma.accountExportRequest.deleteMany({ where: { tenantKey: workspaceSlug } });
    await prisma.accountDeletionRequest.deleteMany({ where: { tenantKey: workspaceSlug } });
    await prisma.authRecoveryToken.deleteMany({
      where: {
        OR: [{ tenantKey: workspaceSlug }, { userId: adminEmail }],
      },
    });
    await prisma.userNotification.deleteMany({ where: { tenantKey: workspaceSlug } });
    await prisma.apiAccessKey.deleteMany({ where: { tenantKey: workspaceSlug } });
    await prisma.connectorPermission.deleteMany({ where: { tenantKey: workspaceSlug } });
    await prisma.outboundWebhookDelivery.deleteMany({ where: { tenantKey: workspaceSlug } });
    await prisma.outboundWebhookEndpoint.deleteMany({ where: { tenantKey: workspaceSlug } });
    await prisma.tenantCommercialRequest.deleteMany({ where: { tenantKey: workspaceSlug } });
    await prisma.planUsage.deleteMany({ where: { tenantKey: workspaceSlug } });
    await prisma.tenantPlanProfile.deleteMany({ where: { tenantKey: workspaceSlug } });
    await prisma.auditLog.deleteMany({ where: { tenantKey: workspaceSlug } });
    await prisma.publicSignupRequest.deleteMany({
      where: {
        OR: [{ workspaceSlug }, { adminEmail }],
      },
    });
    await prisma.authIdentity.deleteMany({
      where: {
        OR: [{ tenantKey: workspaceSlug }, { userId: adminEmail }],
      },
    });
    await prisma.workspaceDirectory.deleteMany({
      where: {
        OR: [{ tenantKey: workspaceSlug }, { workspaceSlug }],
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}

test("admin can process a commercial upgrade request from internal ops", async ({ page }) => {
  assert(SIGNUP_OUTBOX_DIR, "PLAYWRIGHT_SIGNUP_OUTBOX_DIR is required for the internal commercial ops browser flow.");
  const signup = createSignupIdentity();
  const requestNotes = "Please review this workspace for a paid plan and higher usage limits.";

  try {
    const createSignup = await apiRequest("POST", "/signup/workspace", null, {
      displayName: signup.displayName,
      workspaceSlug: signup.workspaceSlug,
      adminEmail: signup.adminEmail,
      password: signup.password,
      acceptedTerms: true,
    });
    expect(createSignup?.status).toBe("pending_verification");

    const signupEmail = await waitForOutboxEmail(
      SIGNUP_OUTBOX_DIR,
      signup.adminEmail,
      "signup_verification",
      10_000,
    );
    const verificationToken = extractVerificationToken(signupEmail);

    const verifyResult = await apiRequest("POST", "/signup/verify", null, { token: verificationToken });
    expect(verifyResult?.status).toBe("verified");

    const workspaceAdminToken = await loginForWorkspace(signup.workspaceSlug, signup.adminEmail, signup.password);
    expect(workspaceAdminToken.length).toBeGreaterThan(10);

    const createdRequest = await apiRequest("POST", "/billing/upgrade-request", workspaceAdminToken, {
      notes: requestNotes,
      source: "admin_plan",
    });
    expect(createdRequest?.created).toBe(true);
    const requestId = String(createdRequest?.item?.id ?? "");
    expect(requestId.length).toBeGreaterThan(5);

    await loginViaWorkspaceUi(page, signup.workspaceSlug, signup.adminEmail, signup.password);
    await page.goto(`/internal/developer?tenantQuery=${encodeURIComponent(signup.workspaceSlug)}`, {
      waitUntil: "domcontentloaded",
    });

    const searchResultCard = page.locator("div.rounded-md.border.border-slate-200.bg-white.p-3", {
      hasText: signup.workspaceSlug,
    }).first();

    await expect(page.getByRole("heading", { name: "Internal Tools" })).toBeVisible();
    await expect(page.getByText("Commercial ops request queue")).toBeVisible();
    await expect(searchResultCard).toBeVisible();
    await expect(searchResultCard).toContainText(signup.displayName);
    await expect(searchResultCard).toContainText(signup.workspaceSlug);

    await searchResultCard.getByRole("link", { name: "View requests" }).click();
    await page.waitForURL(new RegExp(`tenantKey=${encodeURIComponent(signup.workspaceSlug)}`));

    const requestCard = page
      .locator("div.rounded-md.border.bg-white.p-4")
      .filter({
        has: page.getByRole("link", { name: "View detail" }),
        hasText: requestNotes,
      })
      .first();

    await expect(page.getByText("Selected tenant snapshot")).toBeVisible();
    await expect(page.getByText(`Showing requests for ${signup.workspaceSlug}.`)).toBeVisible();
    await expect(requestCard).toContainText(requestNotes);
    await expect(requestCard).toContainText("Open");

    await requestCard.getByRole("link", { name: "View detail" }).click();
    await page.waitForURL(new RegExp(`requestId=${encodeURIComponent(requestId)}`));
    const selectedDetailPanel = page.locator("div.rounded-md.border.border-slate-200.bg-white.p-4", {
      hasText: "Selected request detail",
    }).first();
    await expect(selectedDetailPanel).toBeVisible();
    await expect(selectedDetailPanel).toContainText(`Request ID: ${requestId}`);
    await expect(selectedDetailPanel).toContainText(requestNotes);

    const selectedAuditLink = selectedDetailPanel.getByRole("link", { name: "Selected request audit" });
    await expect(selectedAuditLink).toHaveAttribute("href", new RegExp(`resourceId=${requestId}`));

    await Promise.all([
      page.waitForURL(/actionStatus=acknowledged/),
      requestCard.getByRole("button", { name: "Acknowledge" }).click(),
    ]);
    await expect(page.getByText("Request acknowledged")).toBeVisible();
    await expect(page.getByText("No commercial requests found for this filter.")).toBeVisible();

    const acknowledgedLookup = await apiRequest("GET", "/billing/upgrade-request", workspaceAdminToken);
    expect(acknowledgedLookup?.item?.id).toBe(requestId);
    expect(acknowledgedLookup?.item?.status).toBe("acknowledged");

    await page.getByRole("combobox", { name: "Request filter" }).selectOption("acknowledged");
    await Promise.all([
      page.waitForURL(/requestStatusFilter=acknowledged/),
      page.getByRole("button", { name: "Filter queue" }).click(),
    ]);

    const acknowledgedCard = page
      .locator("div.rounded-md.border.bg-white.p-4")
      .filter({
        has: page.getByRole("link", { name: "View detail" }),
        hasText: requestNotes,
      })
      .first();
    await expect(acknowledgedCard).toBeVisible();
    await expect(acknowledgedCard).toContainText("Acknowledged");

    await Promise.all([
      page.waitForURL(/actionStatus=resolved/),
      acknowledgedCard.getByRole("button", { name: "Resolve" }).click(),
    ]);
    await expect(page.getByText("Request resolved")).toBeVisible();
    await expect(page.getByText("No commercial requests found for this filter.")).toBeVisible();

    const resolvedLookup = await apiRequest("GET", "/billing/upgrade-request", workspaceAdminToken);
    expect(resolvedLookup?.item ?? null).toBeNull();
  } finally {
    try {
      await cleanupSignupWorkspace(signup.workspaceSlug, signup.adminEmail);
    } catch (error) {
      console.error("Internal commercial ops browser flow cleanup failed:", error instanceof Error ? error.message : String(error));
    }
  }
});
