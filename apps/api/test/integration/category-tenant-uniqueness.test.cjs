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
    throw new Error(
      `${context}: expected HTTP ${expected}, got ${result.status}; payload=${JSON.stringify(result.payload)}`,
    );
  }
}

async function login(baseUrl, userId, workspaceSlug) {
  const response = await apiRequest(baseUrl, "POST", "/auth/login", null, {
    userId,
    workspaceSlug,
    password: process.env.PIM_AUTH_PASSWORD || "vexa-pim-demo-password",
    expiresInMinutes: 30,
  });
  assertStatus(response, 201, `login ${userId}`);
  const token = String(response.payload?.accessToken ?? "");
  assert(token.length > 10, `missing access token for ${userId}`);
  return token;
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
  const apiPort = 6720 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantA = `cu-tenant-a-${runId}`;
  const tenantB = `cu-tenant-b-${runId}`;
  const workspaceSlugA = `cua-${runId}`.slice(0, 24);
  const workspaceSlugB = `cub-${runId}`.slice(0, 24);
  const adminA = `cu-admin-a-${runId}`;
  const adminB = `cu-admin-b-${runId}`;

  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantA,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [adminA]: { tenantId: tenantA, role: "admin", workspaceSlug: workspaceSlugA },
      [adminB]: { tenantId: tenantB, role: "admin", workspaceSlug: workspaceSlugB },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlugA]: { tenantId: tenantA, displayName: "Category Uniqueness A" },
      [workspaceSlugB]: { tenantId: tenantB, displayName: "Category Uniqueness B" },
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
    await waitForHealth(
      baseUrl,
      Number.isFinite(API_HEALTH_TIMEOUT_MS) ? API_HEALTH_TIMEOUT_MS : DEFAULT_API_HEALTH_TIMEOUT_MS,
    );
    await sleep(800);

    const tokenA = await loginWithRetry(baseUrl, adminA, workspaceSlugA);
    const tokenB = await loginWithRetry(baseUrl, adminB, workspaceSlugB);

    // SCENARIO 1: Cross-tenant — both tenants can create a category with slug "shirts"
    const sharedCategoryName = "Shirts";

    const catA = await apiRequest(baseUrl, "POST", "/taxonomy/categories", tokenA, {
      name: sharedCategoryName,
    });
    assertStatus(catA, 201, "tenantA creates category 'shirts'");
    const slugA = catA.payload.slug;
    assert(typeof slugA === "string" && slugA.length > 0, `tenantA category must have a slug; got ${slugA}`);

    const catB = await apiRequest(baseUrl, "POST", "/taxonomy/categories", tokenB, {
      name: sharedCategoryName,
    });
    assertStatus(catB, 201, "tenantB creates category 'shirts' (cross-tenant must succeed)");
    const slugB = catB.payload.slug;
    assert(
      slugA === slugB,
      `cross-tenant identical category names must produce the same slug; tenantA=${slugA} tenantB=${slugB}`,
    );

    // SCENARIO 2: Same-tenant — tenantA creates a second category with the same name
    // Current behavior: the system accepts it but suffixes the slug (e.g., "shirts-1")
    // This proves same-tenant slug collision is handled (either suffixed or rejected)
    const catA2 = await apiRequest(baseUrl, "POST", "/taxonomy/categories", tokenA, {
      name: sharedCategoryName,
    });
    assert(
      catA2.status === 201 || (catA2.status >= 409 && catA2.status < 500),
      `tenantA same-name category must either succeed with a unique slug (201) or be rejected (4xx); got ${catA2.status}; payload=${JSON.stringify(catA2.payload)}`,
    );
    if (catA2.status === 201) {
      assert(
        catA2.payload.slug !== slugA,
        `tenantA duplicate category must have a different slug to preserve uniqueness; slugA=${slugA} slugA2=${catA2.payload.slug}`,
      );
    }

    // SCENARIO 3: Tenant isolation — tenantA cannot see tenantB categories
    const listA = await apiRequest(baseUrl, "GET", "/taxonomy/categories?all=true", tokenA);
    assertStatus(listA, 200, "tenantA lists categories");
    const listB = await apiRequest(baseUrl, "GET", "/taxonomy/categories?all=true", tokenB);
    assertStatus(listB, 200, "tenantB lists categories");

    const idsA = new Set(Array.isArray(listA.payload) ? listA.payload.map((c) => c.id) : []);
    const idsB = new Set(Array.isArray(listB.payload) ? listB.payload.map((c) => c.id) : []);

    assert(idsA.has(catA.payload.id), `tenantA list must include tenantA category id=${catA.payload.id}`);
    assert(idsB.has(catB.payload.id), `tenantB list must include tenantB category id=${catB.payload.id}`);
    assert(
      !idsA.has(catB.payload.id),
      `tenantA must NOT see tenantB category id=${catB.payload.id} (tenant isolation breach)`,
    );
    assert(
      !idsB.has(catA.payload.id),
      `tenantB must NOT see tenantA category id=${catA.payload.id} (tenant isolation breach)`,
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantA,
          tenantB,
          slugA,
          slugB,
          validated: [
            "cross_tenant_identical_slug_both_succeed",
            "same_tenant_duplicate_slug_is_handled",
            "category_lists_are_tenant_scoped",
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
    console.error("Category tenant-uniqueness integration test failed:");
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
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
