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
    const value = line.slice(idx + 1).trim().replace(/^\"|\"$/g, "");
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
  setDefaultEnv("PIM_DEFAULT_ROLE", "admin");
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

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const apiPort = 5950 + Math.floor(Math.random() * 100);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantId = `taxonomy-rename-tenant-${runId}`;
  const workspaceSlug = `rename-${runId}`.slice(0, 24);
  const userId = `taxonomy-rename-user-${runId}`;
  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_DEFAULT_ROLE: "admin",
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [userId]: { tenantId, role: "admin", workspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId, displayName: "Taxonomy Rename" },
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

    const login = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      userId,
      workspaceSlug,
      password: process.env.PIM_AUTH_PASSWORD || "vexa-pim-demo-password",
      expiresInMinutes: 30,
    });
    assertStatus(login, 201, "login");
    const token = login.payload?.accessToken;
    assert(typeof token === "string" && token.length > 10, "missing access token");

    const root = await apiRequest(baseUrl, "POST", "/taxonomy/categories", token, {
      name: `Taxonomy Root ${runId}`,
    });
    assertStatus(root, 201, "create root");

    const child = await apiRequest(baseUrl, "POST", "/taxonomy/categories", token, {
      name: "Child",
      parentId: root.payload.id,
    });
    assertStatus(child, 201, "create child");

    const grandchild = await apiRequest(baseUrl, "POST", "/taxonomy/categories", token, {
      name: "Grandchild",
      parentId: child.payload.id,
    });
    assertStatus(grandchild, 201, "create grandchild");

    const rename = await apiRequest(baseUrl, "PATCH", `/taxonomy/categories/${root.payload.id}`, token, {
      name: `Taxonomy Root Renamed ${runId}`,
    });
    assertStatus(rename, 200, "rename root");

    const categories = await apiRequest(baseUrl, "GET", "/taxonomy/categories", token);
    assertStatus(categories, 200, "list categories");
    const items = Array.isArray(categories.payload) ? categories.payload : categories.payload?.items;
    assert(Array.isArray(items), "categories response must be an array");

    const renamedRoot = items.find((category) => category.id === root.payload.id);
    const renamedChild = items.find((category) => category.id === child.payload.id);
    const renamedGrandchild = items.find((category) => category.id === grandchild.payload.id);

    assert(renamedRoot?.path === `Taxonomy Root Renamed ${runId}`, "root path must be updated");
    assert(
      renamedChild?.path === `Taxonomy Root Renamed ${runId} > Child`,
      `child path must follow renamed root, got ${String(renamedChild?.path)}`,
    );
    assert(
      renamedGrandchild?.path === `Taxonomy Root Renamed ${runId} > Child > Grandchild`,
      `grandchild path must follow renamed root, got ${String(renamedGrandchild?.path)}`,
    );
    assert(
      typeof renamedChild?.slug === "string" && renamedChild.slug.startsWith(`taxonomy-root-renamed-${runId}`),
      `child slug must be recomputed from renamed path, got ${String(renamedChild?.slug)}`,
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          validated: [
            "taxonomy_rename_updates_descendant_paths",
            "taxonomy_rename_recomputes_descendant_slugs",
          ],
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error("Taxonomy batch rename integration test failed:");
    console.error(error instanceof Error ? error.message : String(error));
    if (stderrBuffer.length > 0) {
      console.error("--- api stderr tail ---");
      console.error(stderrBuffer.slice(-40).join(""));
    }
    if (stdoutBuffer.length > 0) {
      console.error("--- api stdout tail ---");
      console.error(stdoutBuffer.slice(-40).join(""));
    }
    process.exitCode = 1;
  } finally {
    apiProcess.kill("SIGTERM");
    await sleep(750);
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
