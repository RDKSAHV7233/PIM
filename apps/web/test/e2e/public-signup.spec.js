const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { PrismaClient } = require("@prisma/client");

const { DEFAULT_WORKSPACE } = require("./helpers/vexa-pim.cjs");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const SIGNUP_OUTBOX_DIR = String(process.env.PLAYWRIGHT_SIGNUP_OUTBOX_DIR || "").trim();

// ── Phase 9 pre-condition guard ────────────────────────────────────────────────
// Two conditions that both require skipping:
// 1. PLAYWRIGHT_SIGNUP_OUTBOX_DIR not set — the test reads email files from disk;
//    without the outbox dir it cannot verify email delivery and will always fail.
// 2. global-setup.cjs sets PLAYWRIGHT_SIGNUP_DISABLED=true when the signup feature
//    gate is off (FEATURE_PUBLIC_SIGNUP_ENABLED != true or AUTH_MODE != db).
//    Skip gracefully here rather than failing mid-test with a cryptic 404/disabled error.
test.beforeEach(({ }, testInfo) => {
  if (!SIGNUP_OUTBOX_DIR) {
    testInfo.skip(
      true,
      "PLAYWRIGHT_SIGNUP_OUTBOX_DIR is not set — Phase 9 specs require the email outbox dir. " +
        "Set FEATURE_PUBLIC_SIGNUP_ENABLED=true and AUTH_MODE=db, restart both servers, " +
        "then re-run with PLAYWRIGHT_SIGNUP_OUTBOX_DIR pointing to the API email outbox.",
    );
  }
  if (process.env.PLAYWRIGHT_SIGNUP_DISABLED === "true") {
    testInfo.skip(
      true,
      "Public signup is disabled on this environment. " +
        "Set FEATURE_PUBLIC_SIGNUP_ENABLED=true and AUTH_MODE=db, restart both servers, " +
        "then re-run with PLAYWRIGHT_SIGNUP_OUTBOX_DIR set.",
    );
  }
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createSignupIdentity() {
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const suffix = stamp.slice(-12);
  return {
    displayName: `Playwright Signup ${suffix}`,
    workspaceSlug: `pw-signup-${suffix}`.slice(0, 30),
    adminEmail: `pw-signup-${suffix}@example.com`,
    password: "Signup#2026",
  };
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

test("public signup can verify a workspace and reach trial plan state through the browser", async ({ page }) => {
  // Note: SIGNUP_OUTBOX_DIR guard is handled in beforeEach — no assert needed here.
  const signup = createSignupIdentity();

  try {
    await page.goto("/signup", { waitUntil: "domcontentloaded" });

    await expect(page.getByRole("heading", { name: "Create your Vexa PIM workspace" })).toBeVisible();
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

    // H-1: the token is no longer consumed by the passive page load. The recipient
    // must click through the landing card to run the single-use verification.
    await expect(page.getByRole("button", { name: "Verify my workspace" })).toBeVisible();
    await page.getByRole("button", { name: "Verify my workspace" }).click();

    await expect(
      page.getByText("Your workspace is ready. Sign in with the workspace ID, email, and password you just created."),
    ).toBeVisible();
    await expect(page.getByText(`Workspace: ${signup.workspaceSlug}`)).toBeVisible();
    await expect(page.getByText(`User ID: ${signup.adminEmail}`)).toBeVisible();

    await page.getByRole("link", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/login\?/);
    await expect(page.getByLabel("Workspace", { exact: true })).toHaveValue(signup.workspaceSlug);
    await page.getByLabel("User ID").fill(signup.adminEmail);
    await page.getByLabel("Password", { exact: true }).fill(signup.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL(/\/dashboard$/, { timeout: 20_000 });
    await expect(page.getByText("Role: Admin")).toBeVisible();

    const billingUsage = await page.evaluate(async () => {
      const response = await fetch("/api/billing/usage", {
        method: "GET",
        credentials: "include",
      });
      if (!response.ok) {
        throw new Error(`billing usage failed: ${response.status}`);
      }
      return response.json();
    });
    expect(billingUsage.planTier).toBe("TRIAL");
    expect(billingUsage.billingStatus).toBe("trial");
    expect(billingUsage.accessStatus).toBe("active");
    expect(typeof billingUsage.profile?.trialEndsAt).toBe("string");
    expect(String(billingUsage.profile?.trialEndsAt || "").length).toBeGreaterThan(0);

    await page.goto("/admin/plan", { waitUntil: "domcontentloaded" });
    await expect(page.getByText("Trial is active")).toBeVisible();
  } finally {
    try {
      await cleanupSignupWorkspace(signup.workspaceSlug, signup.adminEmail);
    } catch (error) {
      console.error("Signup browser flow cleanup failed:", error instanceof Error ? error.message : String(error));
    }
  }
});

test("duplicate workspace slug is rejected with unavailable feedback", async ({ page }) => {
  await page.goto("/signup", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Create your Vexa PIM workspace" })).toBeVisible();

  const workspaceInput = page.getByLabel("Workspace", { exact: true });
  await workspaceInput.fill(DEFAULT_WORKSPACE);
  await workspaceInput.blur();

  await expect(
    page.getByText(/taken|unavailable|already exists|already in use/i).first(),
  ).toBeVisible({ timeout: 8_000 });
  await expect(page.getByText("Workspace ID is available.")).not.toBeVisible();
});
