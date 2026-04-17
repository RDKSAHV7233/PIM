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
  setDefaultEnv("PIM_AUTH_PASSWORD", "vexa-pim-demo-password");
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "vexa-pim-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/vexa-pim-local");
  setDefaultEnv("APP_ENV", "development");
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
      // retry
    }
    await sleep(400);
  }
  throw new Error(`API did not become healthy at ${baseUrl}/health within ${timeoutMs}ms`);
}

async function apiRequest(baseUrl, method, route, body, headers) {
  const options = {
    method,
    headers: {
      Accept: "application/json",
      ...(headers ?? {}),
    },
    signal: AbortSignal.timeout(15000),
  };
  if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
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

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const port = 5200 + Math.floor(Math.random() * 80);
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;
  const platformToken = `platform-token-${runId}`;
  const tenantKey = `workspace-provision-${runId}`;
  const workspaceSlug = `ws-${runId}`;
  const displayName = `Workspace Provision ${runId}`;
  const initialAdminUserId = `workspace-admin-${runId}@example.com`;

  const env = {
    ...process.env,
    PORT: String(port),
    AUTH_MODE: "db",
    PIM_PLATFORM_ADMIN_TOKEN: platformToken,
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_AUTH_IDENTITIES_JSON: "",
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
    await waitForHealth(baseUrl, 60000);

    const provision = await apiRequest(
      baseUrl,
      "POST",
      "/platform/tenants",
      { tenantKey, workspaceSlug, displayName, initialAdminUserId },
      { "x-pim-platform-admin-token": platformToken },
    );
    if (provision.status !== 201) {
      throw new Error(`Provisioning failed. status=${provision.status} payload=${JSON.stringify(provision.payload)}`);
    }
    if (provision.payload?.tenantId !== tenantKey || provision.payload?.workspaceSlug !== workspaceSlug) {
      throw new Error(`Provisioning payload mismatch. payload=${JSON.stringify(provision.payload)}`);
    }

    const login = await apiRequest(baseUrl, "POST", "/auth/login", {
      workspaceSlug,
      userId: initialAdminUserId,
      password: process.env.PIM_AUTH_PASSWORD,
    });
    if (login.status !== 201) {
      throw new Error(`Provisioned admin login failed. status=${login.status} payload=${JSON.stringify(login.payload)}`);
    }
    if (login.payload?.tenantId !== tenantKey || login.payload?.role !== "admin") {
      throw new Error(`Provisioned login payload mismatch. payload=${JSON.stringify(login.payload)}`);
    }

    console.log(JSON.stringify({
      status: "ok",
      tenantKey,
      workspaceSlug,
      initialAdminUserId,
      validated: [
        "platform_admin_can_provision_tenant_workspace",
        "provisioned_admin_can_login_with_workspace_slug"
      ],
      checkedAt: new Date().toISOString(),
    }, null, 2));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Platform tenant provisioning integration test failed:");
    console.error(message);
    if (stdoutBuffer.length) {
      console.error("--- API stdout tail ---");
      console.error(stdoutBuffer.join("").slice(-4000));
    }
    if (stderrBuffer.length) {
      console.error("--- API stderr tail ---");
      console.error(stderrBuffer.join("").slice(-4000));
    }
    process.exitCode = 1;
  } finally {
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
