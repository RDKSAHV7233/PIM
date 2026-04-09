const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { PrismaClient } = require("@prisma/client");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const SIGNUP_OUTBOX_DIR = String(process.env.PLAYWRIGHT_SIGNUP_OUTBOX_DIR || "").trim();
const COMMERCIAL_CONTACT_EMAIL = String(process.env.PLAYWRIGHT_COMMERCIAL_CONTACT_EMAIL || "commercial@tej.example").trim();
const API_URL = String(process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:4001/api/v1").trim();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function createSignupIdentity() {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const suffix = stamp.slice(-12);
  return {
    displayName: `Playwright Upgrade ${suffix}`,
    workspaceSlug: `pw-upgrade-${suffix}`.slice(0, 30),
    adminEmail: `pw-upgrade-${suffix}@example.com`,
    password: "Upgrade#2026",
  };
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
  const datasourceUrl = (() => {
    try {
      const parsed = new URL(databaseUrl);
      parsed.searchParams.set("connection_limit", "1");
      return parsed.toString();
    } catch {
      return databaseUrl;
    }
  })();
  return new PrismaClient({
    datasources: {
      db: {
        url: datasourceUrl,
      },
    },
  });
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

async function loginForWorkspace(workspaceSlug, userId, password) {
  const payload = await apiRequest("POST", "/auth/login", null, {
    workspaceSlug,
    userId,
    password,
    expiresInMinutes: 30,
  });
  return String(payload?.accessToken ?? "");
}

test("workspace admin can submit an upgrade request from the plan page", async ({ page }) => {
  assert(SIGNUP_OUTBOX_DIR, "PLAYWRIGHT_SIGNUP_OUTBOX_DIR is required for the admin plan upgrade-request browser flow.");
  const signup = createSignupIdentity();
  const requestNotes = "We need a paid plan review before the trial ends and need room for more users.";

  try {
    await page.goto("/signup", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Create your TEJ PIM workspace" })).toBeVisible();
    await page.getByLabel("Workspace name").fill(signup.displayName);
    const workspaceInput = page.getByLabel("Workspace", { exact: true });
    await workspaceInput.fill(signup.workspaceSlug);
    await workspaceInput.blur();
    await expect(page.getByText("Workspace ID is available.")).toBeVisible();

    await page.getByLabel("User ID").fill(signup.adminEmail);
    await page.getByLabel("Password", { exact: true }).fill(signup.password);
    await page.getByLabel("Confirm new password", { exact: true }).fill(signup.password);
    await page.getByLabel("I accept the Terms of Service and Privacy Policy.").check();
    await page.getByRole("button", { name: "Create workspace" }).click();

    await expect(
      page.getByText("Check your email for the verification link to finish creating your workspace."),
    ).toBeVisible();

    const signupEmail = await waitForOutboxEmail(
      SIGNUP_OUTBOX_DIR,
      signup.adminEmail,
      "signup_verification",
      10_000,
    );
    const verificationToken = extractVerificationToken(signupEmail);

    await page.goto(
      `/signup/verify?token=${encodeURIComponent(verificationToken)}&email=${encodeURIComponent(signup.adminEmail)}&workspace=${encodeURIComponent(signup.workspaceSlug)}`,
      { waitUntil: "domcontentloaded" },
    );

    await expect(
      page.getByText("Your workspace is ready. Sign in with the workspace ID, email, and password you just created."),
    ).toBeVisible();

    await page.getByRole("link", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/login\?/);
    await expect(page.getByLabel("Workspace", { exact: true })).toHaveValue(signup.workspaceSlug);
    await page.getByLabel("User ID").fill(signup.adminEmail);
    await page.getByLabel("Password", { exact: true }).fill(signup.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL(/\/dashboard$/, { timeout: 20_000 });
    await expect(page.getByText("Role: Admin")).toBeVisible();

    await page.goto("/admin/plan", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Trial is active")).toBeVisible();
    await expect(page.getByText("Plan: STARTER", { exact: false })).toBeVisible();

    await page.getByLabel("Request notes").fill(requestNotes);

    await Promise.all([
      page.waitForURL(/requestStatus=submitted/),
      page.getByRole("button", { name: "Request upgrade" }).click(),
    ]);
    await expect(page.getByText("Upgrade request submitted")).toBeVisible();
    await expect(page.getByText("Upgrade request pending")).toBeVisible();
    await expect(page.getByText(requestNotes)).toBeVisible();
    await expect(page.getByText(signup.adminEmail, { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Request upgrade" })).toHaveCount(0);

    const adminToken = await loginForWorkspace(signup.workspaceSlug, signup.adminEmail, signup.password);
    const requestLookup = await apiRequest("GET", "/billing/upgrade-request", adminToken);
    expect(requestLookup?.item?.status).toBe("open");
    expect(requestLookup?.item?.notes).toBe(requestNotes);
    expect(requestLookup?.item?.requestedBy).toBe(signup.adminEmail);
    expect(requestLookup?.item?.currentPlanTier).toBe("STARTER");
    expect(requestLookup?.item?.currentBillingStatus).toBe("trial");
    expect(requestLookup?.item?.currentAccessStatus).toBe("active");

    const requestEmail = await waitForOutboxEmail(
      SIGNUP_OUTBOX_DIR,
      COMMERCIAL_CONTACT_EMAIL,
      "commercial_upgrade_request",
      10_000,
    );
    expect(String(requestEmail.subject ?? "")).toContain(`Upgrade request: ${signup.displayName}`);
    expect(String(requestEmail.text ?? "")).toContain(`Workspace slug: ${signup.workspaceSlug}`);
    expect(String(requestEmail.text ?? "")).toContain(`${signup.adminEmail} requested a commercial plan review.`);
    expect(String(requestEmail.text ?? "")).toContain(requestNotes);

    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.getByText("Upgrade request pending")).toBeVisible();
    await expect(page.getByText(requestNotes)).toBeVisible();
  } finally {
    try {
      await cleanupSignupWorkspace(signup.workspaceSlug, signup.adminEmail);
    } catch (error) {
      console.error("Admin plan upgrade-request browser flow cleanup failed:", error instanceof Error ? error.message : String(error));
    }
  }
});
