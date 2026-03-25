#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

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
  setDefaultEnv("JWT_SECRET", "tej-pim-local-dev-jwt-secret-minimum-length-32");
  setDefaultEnv("JWT_EXPIRY", "4h");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_V1", "tej-pim-local-encryption-key-v1-minimum-32");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION", "1");
  setDefaultEnv("REDIS_URL", "redis://localhost:6379");
  setDefaultEnv("JWT_BLOCKLIST_REDIS_DISABLED", "true");
  setDefaultEnv("PIM_AUTH_REDIS_DISABLED", "true");
  setDefaultEnv("PIM_AUTH_PASSWORD", "tej-pim-demo-password");
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "tej-pim-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/tej-pim-local");
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
      // retry
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
  };
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const port = 6100 + Math.floor(Math.random() * 80);
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;
  const tenantId = `connector-access-validation-${runId}`;
  const workspaceSlug = `cav-${runId}`;
  const adminUser = `admin-${runId}@example.com`;
  const editorUser = `editor-${runId}@example.com`;

  const env = {
    ...process.env,
    PORT: String(port),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [adminUser]: { tenantId, role: "admin", workspaceSlug },
      [editorUser]: { tenantId, role: "editor", workspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId, displayName: "Connector Access Validation" },
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

    const adminLogin = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      workspaceSlug,
      userId: adminUser,
      password: process.env.PIM_AUTH_PASSWORD,
      expiresInMinutes: 30,
    });
    if (adminLogin.status !== 201) {
      throw new Error(`Admin login failed: status=${adminLogin.status} payload=${JSON.stringify(adminLogin.payload)}`);
    }
    const adminToken = String(adminLogin.payload?.accessToken ?? "");
    if (adminToken.length < 10) {
      throw new Error("Missing admin token from login response.");
    }

    const invalidRole = await apiRequest(baseUrl, "POST", "/connectors/permissions", adminToken, {
      principalType: "role",
      principalId: "edtor",
      connectorSlug: "flipkart",
      action: "install",
    });
    if (invalidRole.status !== 400 || invalidRole.payload?.error !== "CONNECTOR_PERMISSION_INVALID_ROLE") {
      throw new Error(`Expected invalid role rejection. status=${invalidRole.status} payload=${JSON.stringify(invalidRole.payload)}`);
    }

    const missingUser = await apiRequest(baseUrl, "POST", "/connectors/permissions", adminToken, {
      principalType: "user",
      principalId: `missing-${runId}@example.com`,
      connectorSlug: "flipkart",
      action: "install",
    });
    if (missingUser.status !== 400 || missingUser.payload?.error !== "CONNECTOR_PERMISSION_USER_NOT_FOUND") {
      throw new Error(`Expected missing user rejection. status=${missingUser.status} payload=${JSON.stringify(missingUser.payload)}`);
    }

    const validRole = await apiRequest(baseUrl, "POST", "/connectors/permissions", adminToken, {
      principalType: "role",
      principalId: "editor",
      connectorSlug: "flipkart",
      action: "install",
    });
    if (validRole.status !== 201 || validRole.payload?.principalId !== "editor") {
      throw new Error(`Expected valid role grant to succeed. status=${validRole.status} payload=${JSON.stringify(validRole.payload)}`);
    }

    const validUser = await apiRequest(baseUrl, "POST", "/connectors/permissions", adminToken, {
      principalType: "user",
      principalId: editorUser,
      connectorSlug: "amazon-in",
      action: "reconnect",
    });
    if (validUser.status !== 201 || String(validUser.payload?.principalId ?? "") !== editorUser) {
      throw new Error(`Expected valid user grant to succeed. status=${validUser.status} payload=${JSON.stringify(validUser.payload)}`);
    }

    console.log(
      JSON.stringify(
        {
          status: "ok",
          validated: [
            "invalid_roles_are_rejected_before_permission_insert",
            "missing_users_are_rejected_for_current_workspace",
            "valid_role_grants_succeed",
            "valid_user_grants_succeed_for_existing_workspace_user",
          ],
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } finally {
    apiProcess.kill("SIGTERM");
    await sleep(500);
    if (!apiProcess.killed) {
      apiProcess.kill("SIGKILL");
    }
  }
}

run().catch((error) => {
  console.error("Connector access principal validation test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
