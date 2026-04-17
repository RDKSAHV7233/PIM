#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");
const MIGRATION_SCRIPT = path.join(REPO_ROOT, "scripts", "migrate-legacy-auth-password-hashes.cjs");

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
    const raw = line.slice(idx + 1).trim();
    const value = raw.replace(/^"|"$/g, "");
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
  setDefaultEnv("JWT_SECRET", "vexa-pim-local-dev-jwt-secret-minimum-length-32");
  setDefaultEnv("JWT_EXPIRY", "4h");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_V1", "vexa-pim-local-encryption-key-v1-minimum-32");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION", "1");
  setDefaultEnv("REDIS_URL", "redis://localhost:6379");
  setDefaultEnv("JWT_BLOCKLIST_REDIS_DISABLED", "true");
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "vexa-pim-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/vexa-pim-local");
  setDefaultEnv("APP_ENV", "development");
  setDefaultEnv("FEATURE_REAL_SPAPI_VALIDATION", "false");
  setDefaultEnv("PIM_AUTH_PASSWORD", "vexa-pim-demo-password");
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

async function apiRequest(baseUrl, method, route, token, body, extraHeaders = {}) {
  const headers = { Accept: "application/json", ...extraHeaders };
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
  const response = await fetch(`${baseUrl}${route}`, options);
  const text = await response.text();
  let payload = null;
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
    throw new Error(`${context} failed: expected ${expected}, got ${result.status}; payload=${JSON.stringify(result.payload)}`);
  }
}

function createPrisma() {
  const url = String(process.env.DATABASE_URL_POOLED ?? process.env.DATABASE_URL ?? "").trim();
  if (!url) {
    throw new Error("DATABASE_URL is required for auth-legacy-hash-migration integration test.");
  }
  return new PrismaClient({ datasources: { db: { url } } });
}

async function login(baseUrl, workspaceSlug, userId, password = process.env.PIM_AUTH_PASSWORD) {
  return apiRequest(baseUrl, "POST", "/auth/login", null, {
    workspaceSlug,
    userId,
    password,
    expiresInMinutes: 30,
  });
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const port = 7250 + Math.floor(Math.random() * 100);
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;
  const platformToken = `auth-legacy-${runId}`;
  const tenantKey = `auth-legacy-${runId}`;
  const workspaceSlug = `al-${runId}`.slice(0, 24);
  const adminUserId = `auth-legacy-admin-${runId}@example.com`;
  const legacyUserLogin = `auth-legacy-login-${runId}@example.com`;
  const legacyUserScript = `auth-legacy-script-${runId}@example.com`;

  const env = {
    ...process.env,
    PORT: String(port),
    AUTH_MODE: "db",
    PIM_PLATFORM_ADMIN_TOKEN: platformToken,
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_AUTH_IDENTITIES_JSON: "",
    PIM_AUTH_WORKSPACES_JSON: "",
  };

  const prisma = createPrisma();
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
      null,
      { tenantKey, workspaceSlug, displayName: `Auth Legacy ${runId}`, initialAdminUserId: adminUserId },
      { "x-pim-platform-admin-token": platformToken },
    );
    assertStatus(provision, 201, "platform tenant provisioning");

    await prisma.authIdentity.createMany({
      data: [
        { tenantKey, userId: legacyUserLogin, role: "viewer", isActive: true, passwordHash: null },
        { tenantKey, userId: legacyUserScript, role: "viewer", isActive: true, passwordHash: null },
      ],
    });

    const legacyLogin = await login(baseUrl, workspaceSlug, legacyUserLogin);
    assertStatus(legacyLogin, 401, "legacy login blocked before migration");
    assert(
      String(legacyLogin.payload?.error ?? "") === "AUTH_CREDENTIAL_MIGRATION_INCOMPLETE",
      `expected migration-incomplete auth error, got ${JSON.stringify(legacyLogin.payload)}`,
    );

    const loginUser = await prisma.authIdentity.findUnique({
      where: { userId: legacyUserLogin },
      select: { passwordHash: true },
    });
    assert(loginUser?.passwordHash === null, "legacy login must not backfill passwordHash after fallback removal");

    const beforeScript = await prisma.authIdentity.findUnique({
      where: { userId: legacyUserScript },
      select: { passwordHash: true },
    });
    assert(beforeScript?.passwordHash === null, "script target should start with null passwordHash");

    const scriptOutputRaw = execFileSync("node", [MIGRATION_SCRIPT, "--tenant", tenantKey], {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        DATABASE_URL_POOLED: process.env.DATABASE_URL_POOLED,
        DATABASE_URL: process.env.DATABASE_URL,
        PIM_AUTH_PASSWORD: process.env.PIM_AUTH_PASSWORD,
      },
      encoding: "utf8",
    });
    const scriptOutput = JSON.parse(scriptOutputRaw);
    assert(Number(scriptOutput.updatedCount) >= 1, `expected migration script to update at least one row: ${scriptOutputRaw}`);
    assert(Number(scriptOutput.remainingCount) === 0, `expected migration script to leave zero rows remaining: ${scriptOutputRaw}`);

    const scriptUser = await prisma.authIdentity.findUnique({
      where: { userId: legacyUserScript },
      select: { passwordHash: true },
    });
    assert(Boolean(scriptUser?.passwordHash), "migration script should backfill passwordHash for remaining legacy rows");

    const migratedLogin = await login(baseUrl, workspaceSlug, legacyUserLogin);
    assertStatus(migratedLogin, 201, "legacy login succeeds after migration script");

    console.log(JSON.stringify({
      status: "ok",
      tenantKey,
      validated: [
        "legacy_login_rejected_until_migrated",
        "migration_script_backfills_remaining_legacy_hashes",
        "migrated_identity_can_login_with_bcrypt_hash",
      ],
      checkedAt: new Date().toISOString(),
    }, null, 2));
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    const stdout = stdoutBuffer.join("").slice(-4000);
    const stderr = stderrBuffer.join("").slice(-4000);
    console.error("Auth legacy hash migration integration test failed:");
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
    await prisma.$disconnect().catch(() => undefined);
    if (!apiProcess.killed && apiProcess.pid) {
      if (process.platform === "win32") {
        try {
          execFileSync("taskkill", ["/pid", String(apiProcess.pid), "/t", "/f"], { stdio: "ignore" });
        } catch {
          // ignore
        }
      } else {
        apiProcess.kill("SIGTERM");
      }
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
