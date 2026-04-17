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
      // Retry.
    }
    await sleep(400);
  }
  throw new Error(`API did not become healthy at ${baseUrl}/health within ${timeoutMs}ms`);
}

async function apiRequest(baseUrl, method, route, token, body, { expectError = false } = {}) {
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
  if (!response.ok && !expectError) {
    throw new Error(`${method} ${route} failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return { status: response.status, payload };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const tenantId = `pagination-tenant-${runId}`;
  const userId = `pagination-user-${runId}`;
  const port = 5400 + Math.floor(Math.random() * 100);
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;
  const authIdentityJson = JSON.stringify({
    [userId]: { tenantId, role: "admin" },
  });

  const env = {
    ...process.env,
    PORT: String(port),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_DEFAULT_ROLE: "admin",
    PIM_AUTH_IDENTITIES_JSON: authIdentityJson,
  };

  const apiProcess = spawn("node", [API_ENTRY], {
    cwd: REPO_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdoutBuffer = [];
  const stderrBuffer = [];
  apiProcess.stdout.on("data", (chunk) => stdoutBuffer.push(String(chunk)));
  apiProcess.stderr.on("data", (chunk) => stderrBuffer.push(String(chunk)));

  try {
    await waitForHealth(baseUrl, 60_000);
    const loginResponse = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      userId,
      tenantId,
      role: "admin",
      password: "vexa-pim-demo-password",
      expiresInMinutes: 30,
    });
    const token = loginResponse.payload?.accessToken;
    assert(typeof token === "string" && token.length > 10, "Login did not return access token.");

    const categoryResponse = await apiRequest(baseUrl, "POST", "/taxonomy/categories", token, {
      name: `Pagination Category ${runId}`,
    });
    const categoryId = categoryResponse.payload?.id;
    assert(typeof categoryId === "string" && categoryId.length > 0, "Category creation failed.");

    for (let i = 1; i <= 3; i += 1) {
      await apiRequest(baseUrl, "POST", "/catalog/products", token, {
        title: `Pagination Product ${i} ${runId}`,
        description: "desc",
        brand: "Vexa PIM",
        categoryId,
        status: "draft",
        attributes: {},
      });
    }

    const legacyProducts = (await apiRequest(baseUrl, "GET", "/catalog/products", token)).payload;
    assert(Array.isArray(legacyProducts), "Legacy /catalog/products response must remain array.");

    const page1 = (await apiRequest(baseUrl, "GET", "/catalog/products?pagination=cursor&limit=2", token)).payload;
    assert(page1 && Array.isArray(page1.items), "Paginated /catalog/products must return items array.");
    assert(page1.limit === 2, `Expected limit=2, got ${page1.limit}`);
    assert(page1.items.length === 2, `Expected first page item count=2, got ${page1.items.length}`);
    assert(typeof page1.nextCursor === "string" && page1.nextCursor.length > 0, "Expected nextCursor on first page.");

    const page2 = (
      await apiRequest(
      baseUrl,
      "GET",
      `/catalog/products?pagination=cursor&limit=2&cursor=${encodeURIComponent(page1.nextCursor)}`,
      token,
      )
    ).payload;
    assert(Array.isArray(page2.items), "Second page items missing.");
    assert(page2.items.length >= 1, "Second page should contain remaining items.");
    const firstPageIds = new Set(page1.items.map((item) => String(item.id)));
    const overlap = page2.items.some((item) => firstPageIds.has(String(item.id)));
    assert(!overlap, "Cursor pagination must not return duplicate records across pages.");

    const overLimit = await apiRequest(
      baseUrl,
      "GET",
      "/catalog/products?pagination=cursor&limit=999",
      token,
      undefined,
      { expectError: true },
    );
    assert(overLimit.status === 400, `Expected 400 for limit > 200, got ${overLimit.status}`);

    const categoryPage = (await apiRequest(baseUrl, "GET", "/taxonomy/categories?pagination=cursor&limit=1", token)).payload;
    assert(categoryPage && Array.isArray(categoryPage.items), "Paginated /taxonomy/categories must return items.");
    assert(categoryPage.limit === 1, `Expected category page limit=1, got ${categoryPage.limit}`);
    assert(categoryPage.items.length === 1, `Expected category page size=1, got ${categoryPage.items.length}`);

    console.log(
      JSON.stringify(
        {
          status: "ok",
          validated: [
            "catalog_legacy_shape_preserved",
            "catalog_cursor_pagination",
            "cursor_no_overlap",
            "cursor_limit_max_enforced",
            "taxonomy_cursor_pagination",
          ],
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    console.error("Cursor pagination integration test failed:");
    console.error(details);
    const stdout = stdoutBuffer.join("").slice(-4000);
    const stderr = stderrBuffer.join("").slice(-4000);
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



