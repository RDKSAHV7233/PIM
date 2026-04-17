#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

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

async function apiRequest(baseUrl, method, route, token, body) {
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
  return {
    status: response.status,
    payload,
    headers: response.headers,
  };
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const port = 5100 + Math.floor(Math.random() * 80);
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;
  const tenantId = `auth-lockout-tenant-${runId}`;
  const otherTenantId = `auth-lockout-other-${runId}`;
  const workspaceSlug = `lock-${runId}`;
  const otherWorkspaceSlug = `other-${runId}`;
  const userId = `auth-lockout-user-${runId}@example.com`;

  const env = {
    ...process.env,
    PORT: String(port),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [userId]: { tenantId, role: "admin", workspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId, displayName: "Primary workspace" },
      [otherWorkspaceSlug]: { tenantId: otherTenantId, displayName: "Secondary workspace" },
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
    stdoutBuffer.push(String(chunk));
    if (stdoutBuffer.length > 200) {
      stdoutBuffer.shift();
    }
  });
  apiProcess.stderr.on("data", (chunk) => {
    stderrBuffer.push(String(chunk));
    if (stderrBuffer.length > 200) {
      stderrBuffer.shift();
    }
  });

  try {
    await waitForHealth(baseUrl, 60_000);

    const unknownWorkspace = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      userId,
      workspaceSlug: "unknown-workspace",
      password: "wrong-password",
    });
    if (unknownWorkspace.status !== 404 || unknownWorkspace.payload?.error !== "WORKSPACE_NOT_FOUND") {
      throw new Error(
        `Expected WORKSPACE_NOT_FOUND for unknown workspace. status=${unknownWorkspace.status} payload=${JSON.stringify(
          unknownWorkspace.payload,
        )}`,
      );
    }

    for (let i = 1; i <= 2; i += 1) {
      const wrongWorkspace = await apiRequest(baseUrl, "POST", "/auth/login", null, {
        userId,
        workspaceSlug: otherWorkspaceSlug,
        password: "wrong-password",
      });
      if (wrongWorkspace.status !== 401) {
        throw new Error(
          `Expected isolated secondary workspace invalid credentials on attempt ${i}, got ${wrongWorkspace.status} payload=${JSON.stringify(
            wrongWorkspace.payload,
          )}`,
        );
      }
    }

    const primaryStillAccessible = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      userId,
      workspaceSlug,
      password: process.env.PIM_AUTH_PASSWORD,
    });
    if (primaryStillAccessible.status !== 201) {
      throw new Error(
        `Expected primary workspace login to remain accessible after secondary workspace lockout. status=${primaryStillAccessible.status} payload=${JSON.stringify(
          primaryStillAccessible.payload,
        )}`,
      );
    }

    const attemptsRemainingSeen = [];
    for (let i = 1; i <= 4; i += 1) {
      const login = await apiRequest(baseUrl, "POST", "/auth/login", null, {
        userId,
        workspaceSlug,
        password: "wrong-password",
      });
      if (login.status !== 401) {
        throw new Error(`Expected 401 on wrong credentials attempt ${i}, got ${login.status} payload=${JSON.stringify(login.payload)}`);
      }
      if (login.payload?.error !== "INVALID_CREDENTIALS") {
        throw new Error(`Expected INVALID_CREDENTIALS on attempt ${i}, got payload=${JSON.stringify(login.payload)}`);
      }
      const remaining = Number(login.payload?.attemptsRemaining);
      if (!Number.isInteger(remaining)) {
        throw new Error(`Expected integer attemptsRemaining on attempt ${i}, got payload=${JSON.stringify(login.payload)}`);
      }
      attemptsRemainingSeen.push(remaining);
    }

    const expected = [4, 3, 2, 1];
    if (JSON.stringify(attemptsRemainingSeen) !== JSON.stringify(expected)) {
      throw new Error(`Unexpected attemptsRemaining progression. expected=${JSON.stringify(expected)} actual=${JSON.stringify(attemptsRemainingSeen)}`);
    }

    const locked = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      userId,
      workspaceSlug,
      password: "wrong-password",
    });
    if (locked.status !== 423 || locked.payload?.error !== "ACCOUNT_LOCKED") {
      throw new Error(`Expected account lock on fifth bad attempt. status=${locked.status} payload=${JSON.stringify(locked.payload)}`);
    }
    if (typeof locked.payload?.unlockAt !== "string" || !locked.payload.unlockAt.includes("T")) {
      throw new Error(`Missing unlockAt in lock response. payload=${JSON.stringify(locked.payload)}`);
    }
    if (typeof locked.payload?.maskedEmail !== "string" || !locked.payload.maskedEmail.includes("***")) {
      throw new Error(`Expected maskedEmail in lock response. payload=${JSON.stringify(locked.payload)}`);
    }

    const resend = await apiRequest(baseUrl, "POST", "/auth/resend-unlock", null, {
      email: userId,
      workspaceSlug,
    });
    if (resend.status !== 201 && resend.status !== 200) {
      throw new Error(`Expected resend unlock success. status=${resend.status} payload=${JSON.stringify(resend.payload)}`);
    }
    if (resend.payload?.ok !== true) {
      throw new Error(`Expected resend unlock payload ok=true. payload=${JSON.stringify(resend.payload)}`);
    }

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantId,
          otherTenantId,
          workspaceSlug,
          otherWorkspaceSlug,
          userId,
          validated: [
            "unknown_workspace_returns_404",
            "workspace_lockout_does_not_leak_across_workspaces",
            "wrong_credentials_401_with_attempts_remaining",
            "attempts_remaining_progression_4_3_2_1",
            "fifth_attempt_locks_account_423",
            "account_locked_payload_contains_unlockAt_and_maskedEmail",
            "resend_unlock_endpoint_works_when_locked",
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
    console.error("Auth login lockout integration test failed:");
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
