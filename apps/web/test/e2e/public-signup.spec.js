const fs = require("node:fs");
const path = require("node:path");
const { test, expect } = require("@playwright/test");
const { PrismaClient } = require("@prisma/client");

const SIGNUP_OUTBOX_DIR = String(process.env.PLAYWRIGHT_SIGNUP_OUTBOX_DIR || "").trim();

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
    displayName: `Playwright Signup ${suffix}`,
    workspaceSlug: `pw-signup-${suffix}`.slice(0, 30),
    adminEmail: `pw-signup-${suffix}@example.com`,
    password: "Signup#2026",
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

async function cleanupSignupWorkspace(workspaceSlug, adminEmail) {
  const prisma = new PrismaClient();
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
  assert(SIGNUP_OUTBOX_DIR, "PLAYWRIGHT_SIGNUP_OUTBOX_DIR is required for the public signup browser flow.");
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
    expect(billingUsage.planTier).toBe("STARTER");
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
