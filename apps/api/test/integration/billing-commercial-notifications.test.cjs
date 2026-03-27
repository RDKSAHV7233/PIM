#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn, execFileSync } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || /^\s*#/.test(line)) {
      continue;
    }
    const idx = line.indexOf("=");
    if (idx === -1) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^"|"$/g, "");
    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

function setDefaultEnv(name, value) {
  if (!process.env[name] || String(process.env[name]).trim().length === 0) {
    process.env[name] = value;
  }
}

function prepareEnv() {
  readEnvFile(path.join(REPO_ROOT, ".env"));
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    setDefaultEnv("DATABASE_URL_POOLED", databaseUrl);
    setDefaultEnv("DATABASE_URL_DIRECT", databaseUrl);
  }
  setDefaultEnv("JWT_SECRET", "tej-pim-local-dev-jwt-secret-minimum-length-32");
  setDefaultEnv("JWT_EXPIRY", "4h");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_V1", "tej-pim-local-encryption-key-v1-minimum-32");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION", "1");
  setDefaultEnv("REDIS_URL", "redis://localhost:6379");
  setDefaultEnv("JWT_BLOCKLIST_REDIS_DISABLED", "true");
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "tej-pim-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/tej-pim-local");
  setDefaultEnv("APP_ENV", "development");
  setDefaultEnv("AUTH_MODE", "db");
  setDefaultEnv("PIM_DEFAULT_ROLE", "admin");
  setDefaultEnv("FEATURE_REAL_SPAPI_VALIDATION", "false");
  setDefaultEnv("PIM_AUTH_PASSWORD", "tej-pim-demo-password");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`, { method: "GET" });
      if (response.ok) {
        return;
      }
    } catch {
      // retry
    }
    await sleep(400);
  }
  throw new Error(`API did not become healthy at ${baseUrl}/health within ${timeoutMs}ms`);
}

async function apiRequest(baseUrl, method, route, body, extraHeaders) {
  const headers = { Accept: "application/json", ...(extraHeaders ?? {}) };
  const options = {
    method,
    headers,
    signal: AbortSignal.timeout(20_000),
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${route}`, options);
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return { status: response.status, payload };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertStatus(result, expected, context) {
  if (result.status !== expected) {
    throw new Error(`${context} failed: expected ${expected}, got ${result.status} payload=${JSON.stringify(result.payload)}`);
  }
}

function listEmailFiles(outboxDir) {
  if (!fs.existsSync(outboxDir)) {
    return [];
  }
  return fs
    .readdirSync(outboxDir)
    .filter((file) => file.endsWith(".json"))
    .sort()
    .map((file) => path.join(outboxDir, file));
}

async function waitForEmailCount(outboxDir, expectedCount, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const files = listEmailFiles(outboxDir);
    if (files.length >= expectedCount) {
      return files;
    }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${expectedCount} outbox files in ${outboxDir}`);
}

function readEmails(outboxDir) {
  return listEmailFiles(outboxDir).map((filePath) => JSON.parse(fs.readFileSync(filePath, "utf8")));
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const databaseUrl = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for billing commercial notifications integration test.");
  }

  const runId = Date.now().toString();
  const apiPort = 6540 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const platformToken = `platform-notify-${runId}`;
  const commercialToken = `commercial-notify-${runId}`;
  const tenantId = `notify-tenant-${runId}`;
  const workspaceSlug = `notify-${runId}`.slice(0, 24);
  const displayName = `Notify Workspace ${runId}`;
  const adminUser = `notify-admin-${runId}@example.com`;
  const secondActiveAdmin = `notify-admin2-${runId}@example.com`;
  const inactiveAdmin = `notify-inactive-${runId}@example.com`;
  const outboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "pim1-commercial-email-"));
  const prisma = new PrismaClient({
    datasources: {
      db: { url: databaseUrl },
    },
  });

  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_PLATFORM_ADMIN_TOKEN: platformToken,
    PIM_COMMERCIAL_OPS_TOKEN: commercialToken,
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_AUTH_IDENTITIES_JSON: "",
    PIM_AUTH_WORKSPACES_JSON: "",
    AUTH_EMAIL_PROVIDER: "file",
    AUTH_EMAIL_OUTBOX_DIR: outboxDir,
    PIM_COMMERCIAL_CONTACT_EMAIL: "commercial@tej.example",
    PIM_AUTH_PASSWORD: "tej-pim-demo-password",
  };

  const stdoutBuffer = [];
  const stderrBuffer = [];
  const apiProcess = spawn("node", [API_ENTRY], {
    cwd: REPO_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  apiProcess.stdout.on("data", (chunk) => {
    stdoutBuffer.push(String(chunk));
    if (stdoutBuffer.length > 200) stdoutBuffer.shift();
  });
  apiProcess.stderr.on("data", (chunk) => {
    stderrBuffer.push(String(chunk));
    if (stderrBuffer.length > 200) stderrBuffer.shift();
  });

  try {
    await waitForHealth(baseUrl, 60_000);

    const provision = await apiRequest(
      baseUrl,
      "POST",
      "/platform/tenants",
      {
        tenantKey: tenantId,
        workspaceSlug,
        displayName,
        initialAdminUserId: adminUser,
      },
      { "x-pim-platform-admin-token": platformToken },
    );
    assertStatus(provision, 201, "platform tenant provisioning");

    await prisma.authIdentity.createMany({
      data: [
        {
          tenantKey: tenantId,
          userId: secondActiveAdmin,
          role: "admin",
          isActive: true,
        },
        {
          tenantKey: tenantId,
          userId: inactiveAdmin,
          role: "admin",
          isActive: false,
        },
      ],
    });

    const planUpdate = await apiRequest(
      baseUrl,
      "POST",
      "/billing/internal/plan-tier",
      {
        tenantKey: tenantId,
        planTier: "GROWTH",
      },
      {
        "x-pim-commercial-ops-token": commercialToken,
        "x-pim-operator-id": "ops-commercial",
        "x-pim-operator-role": "commercial_ops",
      },
    );
    assert(planUpdate.status === 200 || planUpdate.status === 201, `plan update failed payload=${JSON.stringify(planUpdate.payload)}`);

    await waitForEmailCount(outboxDir, 2, 10_000);
    const firstWave = readEmails(outboxDir).filter((entry) =>
      String(entry.subject ?? "").includes(`Plan updated: ${displayName}`),
    );
    assert(firstWave.length === 2, `expected two commercial plan emails payload=${JSON.stringify(firstWave)}`);
    const firstRecipients = firstWave.map((entry) => String(entry.to ?? "")).sort();
    assert(
      JSON.stringify(firstRecipients) === JSON.stringify([adminUser, secondActiveAdmin].sort()),
      `expected active admin recipients only payload=${JSON.stringify(firstWave)}`,
    );
    for (const email of firstWave) {
      assert(String(email.category ?? "") === "commercial_status_notice", `unexpected email category payload=${JSON.stringify(email)}`);
      assert(
        String(email.subject ?? "").includes(`Plan updated: ${displayName}`),
        `expected plan update subject payload=${JSON.stringify(email)}`,
      );
      assert(
        String(email.text ?? "").includes(`Workspace slug: ${workspaceSlug}`) &&
          String(email.text ?? "").includes("Plan tier: GROWTH") &&
          String(email.text ?? "").includes("Billing status: active_paid"),
        `expected plan update commercial details payload=${JSON.stringify(email)}`,
      );
      assert(
        String(email.text ?? "").includes("commercial@tej.example"),
        `expected commercial contact fallback in email payload=${JSON.stringify(email)}`,
      );
    }

    const suspend = await apiRequest(
      baseUrl,
      "POST",
      "/billing/internal/commercial-state",
      {
        tenantKey: tenantId,
        billingStatus: "past_due",
        accessStatus: "suspended",
        billingContactEmail: `billing-contact-${runId}@example.com`,
        suspensionReason: "non_payment_validation",
      },
      {
        "x-pim-commercial-ops-token": commercialToken,
        "x-pim-operator-id": "ops-commercial",
        "x-pim-operator-role": "commercial_ops",
      },
    );
    assert(suspend.status === 200 || suspend.status === 201, `suspend failed payload=${JSON.stringify(suspend.payload)}`);

    await waitForEmailCount(outboxDir, 3, 10_000);
    const allEmails = readEmails(outboxDir);
    assert(allEmails.length === 3, `expected three commercial emails after suspension payload=${JSON.stringify(allEmails)}`);
    const suspensionEmails = allEmails.filter((entry) =>
      String(entry.subject ?? "").includes(`Workspace access suspended: ${displayName}`),
    );
    assert(suspensionEmails.length === 1, `expected one suspension email payload=${JSON.stringify(allEmails)}`);
    const suspensionRecipients = suspensionEmails.map((entry) => String(entry.to ?? "")).sort();
    assert(
      JSON.stringify(suspensionRecipients) === JSON.stringify([`billing-contact-${runId}@example.com`]),
      `expected suspension email to route to explicit billing contact payload=${JSON.stringify(suspensionEmails)}`,
    );
    for (const email of suspensionEmails) {
      assert(
        String(email.subject ?? "").includes(`Workspace access suspended: ${displayName}`),
        `expected suspension subject payload=${JSON.stringify(email)}`,
      );
      assert(
        String(email.text ?? "").includes("Access status: suspended") &&
          String(email.text ?? "").includes("Billing status: past_due") &&
          String(email.text ?? "").includes("Reason: non_payment_validation") &&
          String(email.text ?? "").includes(`Billing contact: billing-contact-${runId}@example.com`),
        `expected suspension commercial details payload=${JSON.stringify(email)}`,
      );
    }

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantId,
          validated: [
            "commercial_plan_updates_email_active_admins",
            "commercial_notifications_skip_inactive_admins",
            "commercial_notifications_include_workspace_and_state_context",
            "explicit_billing_contact_overrides_active_admin_fallback",
          ],
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    const stdout = stdoutBuffer.join("").slice(-4000);
    const stderr = stderrBuffer.join("").slice(-4000);
    console.error("Billing commercial notifications integration test failed:");
    console.error(details);
    if (stdout) {
      console.error("--- API stdout tail ---");
      console.error(stdout);
    }
    if (stderr) {
      console.error("--- API stderr tail ---");
      console.error(stderr);
    }
    process.exitCode = 1;
  } finally {
    fs.rmSync(outboxDir, { recursive: true, force: true });
    await prisma.$disconnect().catch(() => undefined);
    if (apiProcess.pid) {
      try {
        if (process.platform === "win32") {
          execFileSync("taskkill", ["/pid", String(apiProcess.pid), "/t", "/f"], { stdio: "ignore" });
        } else {
          apiProcess.kill("SIGTERM");
        }
      } catch {
        // ignore cleanup failures
      }
    }
  }
}

run();
