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
    displayName: `Playwright Dashboard ${suffix}`,
    workspaceSlug: `pw-dash-${suffix}`.slice(0, 30),
    adminEmail: `pw-dash-${suffix}@example.com`,
    password: "Dashboard#2026",
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

function hasMetricPoint(points, predicate) {
  return Array.isArray(points) && points.some((point) => predicate(Number(point?.value ?? 0)));
}

test("workspace admin can drill from dashboard signup funnel into admin plan trends", async ({ page }) => {
  assert(SIGNUP_OUTBOX_DIR, "PLAYWRIGHT_SIGNUP_OUTBOX_DIR is required for the dashboard signup drilldown flow.");
  const signup = createSignupIdentity();

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

    const signupTrends = await apiRequest("GET", "/metrics/kpi-trends?days=30", workspaceAdminToken);
    expect(hasMetricPoint(signupTrends?.signupRequests, (value) => value >= 1)).toBe(true);
    expect(hasMetricPoint(signupTrends?.signupVerifications, (value) => value >= 1)).toBe(true);
    expect(hasMetricPoint(signupTrends?.signupVerificationRate, (value) => value > 0)).toBe(true);

    await loginViaWorkspaceUi(page, signup.workspaceSlug, signup.adminEmail, signup.password);

    await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
    await expect(page.getByText("Signup Funnel")).toBeVisible();
    await expect(page.getByText("Pending Verification Backlog")).toBeVisible();
    await expect(page.getByText("No pending verifications remain in the last 30 days.")).toBeVisible();

    await Promise.all([
      page.waitForURL(/\/admin\/plan\?days=30/),
      page.getByRole("link", { name: "Open signup trends" }).click(),
    ]);

    await expect(page.getByRole("heading", { name: "Plan and Usage", level: 1 })).toBeVisible();
    await expect(page.getByText("Self-Serve Signup Conversion")).toBeVisible();
    await expect(page.getByText("Pending Verification Backlog")).toBeVisible();
    await expect(page.getByText("Every signup request in the last 30 days has verified.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Last 30 days" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Export CSV" })).toHaveAttribute(
      "href",
      /\/api\/admin\/plan\/signup-trends\/export\?days=30/,
    );
    expect(new URL(page.url()).hash).toBe("#signup-conversion");
  } finally {
    try {
      await cleanupSignupWorkspace(signup.workspaceSlug, signup.adminEmail);
    } catch (error) {
      console.error(
        "Dashboard signup drilldown browser flow cleanup failed:",
        error instanceof Error ? error.message : String(error),
      );
    }
  }
});
