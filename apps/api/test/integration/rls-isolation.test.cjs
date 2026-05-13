#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { execFileSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");
const AUTH_PASSWORD = process.env.PIM_AUTH_PASSWORD || "vexa-pim-demo-password";
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
  const localDatabaseUrl = "postgresql://postgres:postgres@localhost:5432/pim1?schema=public";
  const databaseUrl = String(process.env.DATABASE_URL ?? "").trim();
  if (!databaseUrl || /HOST:5432/i.test(databaseUrl)) {
    process.env.DATABASE_URL = localDatabaseUrl;
  }
  if (!process.env.DATABASE_URL_POOLED || /HOST:5432/i.test(String(process.env.DATABASE_URL_POOLED))) {
    process.env.DATABASE_URL_POOLED = process.env.DATABASE_URL;
  }
  if (!process.env.DATABASE_URL_DIRECT || /HOST:5432/i.test(String(process.env.DATABASE_URL_DIRECT))) {
    process.env.DATABASE_URL_DIRECT = process.env.DATABASE_URL;
  }

  setDefaultEnv("JWT_SECRET", "vexa-pim-local-dev-jwt-secret-minimum-length-32");
  setDefaultEnv("JWT_EXPIRY", "4h");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_V1", "vexa-pim-local-encryption-key-v1-minimum-32");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION", "1");
  setDefaultEnv("REDIS_URL", "redis://localhost:6379");
  setDefaultEnv("JWT_BLOCKLIST_REDIS_DISABLED", "true");
  setDefaultEnv("PIM_AUTH_REDIS_DISABLED", "true");
  setDefaultEnv("PIM_AUTH_PASSWORD", "vexa-pim-demo-password");
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "vexa-pim-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/vexa-pim-local");
  setDefaultEnv("APP_ENV", "development");
  setDefaultEnv("PIM_DEFAULT_ROLE", "admin");
  setDefaultEnv("FEATURE_REAL_SPAPI_VALIDATION", "false");
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
      // Retry until timeout.
    }
    await sleep(400);
  }
  throw new Error(`API did not become healthy at ${baseUrl}/health within ${timeoutMs}ms`);
}

async function apiJson(baseUrl, method, route, token, body) {
  const headers = { Accept: "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const options = {
    method,
    headers,
    signal: AbortSignal.timeout(15_000),
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
  if (!response.ok) {
    throw new Error(`${method} ${route} failed (${response.status}): ${typeof payload === "string" ? payload : JSON.stringify(payload)}`);
  }
  return payload;
}

async function login(baseUrl, userId, workspaceSlug) {
  const response = await apiJson(baseUrl, "POST", "/auth/login", null, {
    userId,
    workspaceSlug,
    password: AUTH_PASSWORD,
    expiresInMinutes: 30,
  });
  if (!response || !response.accessToken) {
    throw new Error(`Login did not return accessToken for user ${userId}`);
  }
  return response.accessToken;
}

async function loginWithRetry(baseUrl, userId, workspaceSlug, maxAttempts = 8, delayMs = 600) {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await login(baseUrl, userId, workspaceSlug);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("401") && !message.includes("INVALID_CREDENTIALS")) {
        throw error;
      }
      if (attempt < maxAttempts) {
        await sleep(delayMs);
      }
    }
  }
  throw lastError;
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const port = 4700 + Math.floor(Math.random() * 200);
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;
  const tenantA = `rls-tenant-a-${runId}`;
  const tenantB = `rls-tenant-b-${runId}`;
  const workspaceSlugA = `rlsa-${runId}`.slice(0, 24);
  const workspaceSlugB = `rlsb-${runId}`.slice(0, 24);
  const userA = `rls-user-a-${runId}`;
  const userB = `rls-user-b-${runId}`;
  const categoryA = `RLS Isolation A ${runId}`;
  const categoryB = `RLS Isolation B ${runId}`;

  const env = {
    ...process.env,
    PORT: String(port),
    PIM_AUTH_PASSWORD: AUTH_PASSWORD,
    PIM_AUTH_IP_ATTEMPT_LIMIT: "200",
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantA,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [userA]: { tenantId: tenantA, role: "admin", workspaceSlug: workspaceSlugA },
      [userB]: { tenantId: tenantB, role: "admin", workspaceSlug: workspaceSlugB },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlugA]: { tenantId: tenantA, displayName: "RLS A" },
      [workspaceSlugB]: { tenantId: tenantB, displayName: "RLS B" },
    }),
  };

  const stdoutBuffer = [];
  const stderrBuffer = [];
  const apiProcess = spawn("node", [API_ENTRY], {
    cwd: REPO_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  apiProcess.stdout.on("data", (chunk) => {
    const value = String(chunk);
    stdoutBuffer.push(value);
    if (stdoutBuffer.length > 200) {
      stdoutBuffer.shift();
    }
  });
  apiProcess.stderr.on("data", (chunk) => {
    const value = String(chunk);
    stderrBuffer.push(value);
    if (stderrBuffer.length > 200) {
      stderrBuffer.shift();
    }
  });

  try {
    await waitForHealth(baseUrl, 60_000);
    // Allow the auth module's onModuleInit to finish loading injected identities
    // before attempting login. waitForHealth only confirms the HTTP server is up.
    await sleep(800);

    const tokenA = await loginWithRetry(baseUrl, userA, workspaceSlugA);
    const tokenB = await loginWithRetry(baseUrl, userB, workspaceSlugB);

    await apiJson(baseUrl, "POST", "/taxonomy/categories", tokenA, { name: categoryA });
    await apiJson(baseUrl, "POST", "/taxonomy/categories", tokenB, { name: categoryB });

    const totalRequests = 100;
    const requests = Array.from({ length: totalRequests }, (_, index) => {
      const isA = index % 2 === 0;
      const token = isA ? tokenA : tokenB;
      const expected = isA ? categoryA : categoryB;
      const forbidden = isA ? categoryB : categoryA;
      const tenant = isA ? tenantA : tenantB;
      return apiJson(baseUrl, "GET", "/taxonomy/categories?all=true", token).then((categories) => {
        if (!Array.isArray(categories)) {
          throw new Error(`Expected array for tenant ${tenant}`);
        }
        const names = new Set(categories.map((item) => String(item?.name ?? "")));
        if (!names.has(expected)) {
          throw new Error(`Tenant ${tenant} response missing expected category ${expected}`);
        }
        if (names.has(forbidden)) {
          throw new Error(`Tenant ${tenant} response leaked category ${forbidden}`);
        }
        return { tenant, ok: true };
      });
    });

    const settled = await Promise.allSettled(requests);
    const failures = settled
      .filter((entry) => entry.status === "rejected")
      .map((entry) => (entry.reason instanceof Error ? entry.reason.message : String(entry.reason)));
    if (failures.length > 0) {
      const tenantAFailures = failures.filter((entry) => entry.includes(tenantA)).length;
      const tenantBFailures = failures.filter((entry) => entry.includes(tenantB)).length;
      throw new Error(
        `Isolation failures=${failures.length}; tenantAFailures=${tenantAFailures}; tenantBFailures=${tenantBFailures}; sample=${failures.slice(0, 5).join(" | ")}`,
      );
    }

    const results = settled
      .filter((entry) => entry.status === "fulfilled")
      .map((entry) => entry.value);
    const tenantACount = results.filter((result) => result.tenant === tenantA).length;
    const tenantBCount = results.filter((result) => result.tenant === tenantB).length;

    console.log(
      JSON.stringify(
        {
          status: "ok",
          totalRequests,
          tenantARequests: tenantACount,
          tenantBRequests: tenantBCount,
          tenantA,
          tenantB,
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
    console.error("RLS concurrency test failed:");
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
    if (!apiProcess.killed && apiProcess.pid) {
      if (process.platform === "win32") {
        try {
          execFileSync("taskkill", ["/pid", String(apiProcess.pid), "/t", "/f"], {
            stdio: "ignore",
          });
        } catch {
          // Ignore cleanup failures.
        }
      } else {
        apiProcess.kill("SIGTERM");
        await sleep(500);
        if (!apiProcess.killed) {
          apiProcess.kill("SIGKILL");
        }
      }
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});


