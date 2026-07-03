#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");
const DEFAULT_API_HEALTH_TIMEOUT_MS = REPO_ROOT.startsWith("/mnt/") ? 600_000 : 240_000;
const API_HEALTH_TIMEOUT_MS = Number.parseInt(
  process.env.PIM_INTEGRATION_API_HEALTH_TIMEOUT_MS || String(DEFAULT_API_HEALTH_TIMEOUT_MS),
  10,
);

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

function hasTenantMismatch(payload) {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  const message = Array.isArray(payload.message) ? payload.message.join(" ") : String(payload.message ?? "");
  return message.toLowerCase().includes("tenantkey mismatch");
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const apiPort = 6000 + Math.floor(Math.random() * 200);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantId = `bulk-tenant-${runId}`;
  const otherTenantId = `bulk-tenant-other-${runId}`;
  const userId = `bulk-user-${runId}`;
  const workspaceSlug = `bulk-${runId}`.slice(0, 24);
  const authIdentityJson = JSON.stringify({
    [userId]: { tenantId, role: "admin", workspaceSlug },
  });

  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_DEFAULT_ROLE: "admin",
    PIM_AUTH_IDENTITIES_JSON: authIdentityJson,
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId, displayName: "Bulk Import Boundary" },
    }),
    PIM_AUTH_PASSWORD: "vexa-pim-demo-password",
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
    await waitForHealth(
      baseUrl,
      Number.isFinite(API_HEALTH_TIMEOUT_MS) ? API_HEALTH_TIMEOUT_MS : DEFAULT_API_HEALTH_TIMEOUT_MS,
    );

    const login = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      userId,
      workspaceSlug,
      password: "vexa-pim-demo-password",
      expiresInMinutes: 30,
    });
    assertStatus(login, 201, "login");
    const token = login.payload?.accessToken;
    assert(typeof token === "string" && token.length > 10, "missing access token");

    const category = await apiRequest(baseUrl, "POST", "/taxonomy/categories", token, {
      name: `Bulk Template Category ${runId}`,
    });
    assertStatus(category, 201, "create category");

    const createTemplate = await apiRequest(baseUrl, "POST", "/bulk-import/templates", token, {
      tenantKey: tenantId,
      categoryId: category.payload.id,
      name: `Template ${runId}`,
      sourceFormat: "csv",
    });
    assertStatus(createTemplate, 201, "create template with matching tenant");
    const templateId = createTemplate.payload?.id;
    assert(typeof templateId === "string" && templateId.length > 0, "template id missing");

    const listMatching = await apiRequest(
      baseUrl,
      "GET",
      `/bulk-import/templates?tenantKey=${encodeURIComponent(tenantId)}`,
      token,
    );
    assertStatus(listMatching, 200, "list templates with matching tenant");

    const listMismatch = await apiRequest(
      baseUrl,
      "GET",
      `/bulk-import/templates?tenantKey=${encodeURIComponent(otherTenantId)}`,
      token,
    );
    assertStatus(listMismatch, 400, "list templates tenant mismatch");
    assert(hasTenantMismatch(listMismatch.payload), "expected tenant mismatch message on list");

    const getMismatch = await apiRequest(
      baseUrl,
      "GET",
      `/bulk-import/templates/${encodeURIComponent(templateId)}?tenantKey=${encodeURIComponent(otherTenantId)}`,
      token,
    );
    assertStatus(getMismatch, 400, "get template tenant mismatch");
    assert(hasTenantMismatch(getMismatch.payload), "expected tenant mismatch message on get");

    const createMismatch = await apiRequest(baseUrl, "POST", "/bulk-import/templates", token, {
      tenantKey: otherTenantId,
      categoryId: category.payload.id,
      name: `Template Mismatch ${runId}`,
      sourceFormat: "csv",
    });
    assertStatus(createMismatch, 400, "create template tenant mismatch");
    assert(hasTenantMismatch(createMismatch.payload), "expected tenant mismatch message on create");

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantId,
          validated: [
            "bulk_import_template_create_allows_matching_tenant",
            "bulk_import_template_list_denies_tenant_mismatch",
            "bulk_import_template_get_denies_tenant_mismatch",
            "bulk_import_template_create_denies_tenant_mismatch",
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
    console.error("Bulk import tenant boundary integration test failed:");
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
          execFileSync("taskkill", ["/pid", String(apiProcess.pid), "/t", "/f"], { stdio: "ignore" });
        } catch {
          // ignore
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
