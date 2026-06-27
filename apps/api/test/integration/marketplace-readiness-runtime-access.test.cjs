#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_START_SCRIPT = path.join(REPO_ROOT, "apps", "api", "scripts", "start-built-api.cjs");
const API_SOURCE_ENTRY = path.join(REPO_ROOT, "apps", "api", "src", "main.ts");
const API_TS_NODE_PROJECT = path.join(REPO_ROOT, "apps", "api", "tsconfig.json");
const SCHEMA_PATH = path.join(REPO_ROOT, "packages", "db", "prisma", "schema.prisma");
const PRISMA_BIN = process.platform === "win32"
  ? path.join(REPO_ROOT, "node_modules", ".bin", "prisma.cmd")
  : path.join(REPO_ROOT, "node_modules", ".bin", "prisma");
const DEFAULT_BOOT_TIMEOUT_MS = REPO_ROOT.startsWith("/mnt/") ? 600_000 : 60_000;
const MIGRATION_FILES = [
  path.join(
    REPO_ROOT,
    "packages",
    "db",
    "prisma",
    "migrations",
    "20260318173000_api_access_keys_foundation",
    "migration.sql",
  ),
  path.join(
    REPO_ROOT,
    "packages",
    "db",
    "prisma",
    "migrations",
    "20260427113000_api_access_key_scopes",
    "migration.sql",
  ),
  path.join(
    REPO_ROOT,
    "packages",
    "db",
    "prisma",
    "migrations",
    "20260429113000_add_auth_identity_assigned_roles",
    "migration.sql",
  ),
  path.join(
    REPO_ROOT,
    "packages",
    "db",
    "prisma",
    "migrations",
    "20260428131500_add_product_vendor_scope_key",
    "migration.sql",
  ),
];

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

function toPsqlConnectionString(databaseUrl) {
  try {
    const parsed = new URL(databaseUrl);
    parsed.searchParams.delete("schema");
    parsed.searchParams.delete("connection_limit");
    return parsed.toString();
  } catch {
    return String(databaseUrl ?? "")
      .replace(/([?&])schema=[^&]*(&?)/i, "$1")
      .replace(/([?&])connection_limit=[^&]*(&?)/i, "$1")
      .replace(/[?&]$/, "");
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
  setDefaultEnv("PGCONNECT_TIMEOUT", "5");
}

function runMigrations() {
  const env = {
    ...process.env,
    DATABASE_URL: String(process.env.DATABASE_URL ?? "").trim(),
    DATABASE_URL_POOLED: String(process.env.DATABASE_URL_POOLED ?? process.env.DATABASE_URL ?? "").trim(),
    DATABASE_URL_DIRECT: String(process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL ?? "").trim(),
    PGCONNECT_TIMEOUT: String(process.env.PGCONNECT_TIMEOUT ?? "5"),
  };
  const psqlBinary = process.platform === "win32" ? "psql.exe" : "psql";
  const bootstrappedQuery = [
    "select",
    "  exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'api_access_keys')::int,",
    "  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'api_access_keys' and column_name = 'scopes')::int,",
    "  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'AuthIdentity' and column_name = 'assigned_roles')::int,",
    "  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'Product' and column_name = 'vendor_scope_key')::int;",
  ].join(" ");
  try {
    const probeOutput = execFileSync(
      psqlBinary,
      [toPsqlConnectionString(env.DATABASE_URL), "-tAc", bootstrappedQuery],
      {
        cwd: REPO_ROOT,
        stdio: "pipe",
        encoding: "utf8",
        env,
        timeout: 10_000,
      },
    ).trim();
    const markers = probeOutput.split("|").map((value) => value.trim());
    if (markers.length === 4 && markers.every((value) => value === "1")) {
      return;
    }
  } catch {
    // Fall through to targeted migration replays when the probe is unavailable.
  }
  for (const migrationFile of MIGRATION_FILES) {
    try {
      execFileSync(PRISMA_BIN, ["db", "execute", "--schema", SCHEMA_PATH, "--file", migrationFile], {
        cwd: REPO_ROOT,
        stdio: "pipe",
        encoding: "utf8",
        env,
        timeout: 20_000,
      });
    } catch (error) {
      const output = `${error.stdout ?? ""}\n${error.stderr ?? ""}`;
      if (/already exists/i.test(output) || /already contains|duplicate column/i.test(output)) {
        continue;
      }
      throw error;
    }
  }
}

function getBootTimeoutMs() {
  const raw = process.env.PIM_API_BOOT_TIMEOUT_MS;
  if (!raw) {
    return DEFAULT_BOOT_TIMEOUT_MS;
  }
  const parsed = Number.parseInt(String(raw), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_BOOT_TIMEOUT_MS;
}

function resolveApiBootCommand() {
  const mode = String(process.env.PIM_RUNTIME_ACCESS_BOOT_MODE || "source").trim().toLowerCase();
  if (mode === "built") {
    return {
      requiredPath: API_START_SCRIPT,
      command: "node",
      args: [API_START_SCRIPT],
      extraEnv: {},
      mode,
    };
  }
  return {
    requiredPath: API_SOURCE_ENTRY,
    command: "node",
    args: ["-r", "ts-node/register/transpile-only", API_SOURCE_ENTRY],
    extraEnv: {
      TS_NODE_PROJECT: API_TS_NODE_PROJECT,
      TS_NODE_COMPILER_OPTIONS: JSON.stringify({
        module: "CommonJS",
        moduleResolution: "Node",
      }),
    },
    mode: "source",
  };
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

function createProcessExitPromise(childProcess) {
  return new Promise((resolve) => {
    childProcess.once("exit", (code, signal) => {
      resolve({
        code,
        signal,
      });
    });
  });
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
    throw new Error(`${context} failed: expected ${expected}, got ${result.status}; payload=${JSON.stringify(result.payload)}`);
  }
}

async function login(baseUrl, workspaceSlug, userId, password) {
  return apiRequest(baseUrl, "POST", "/auth/login", null, {
    workspaceSlug,
    userId,
    password,
    expiresInMinutes: 30,
  });
}

async function commercialPlanRequest(baseUrl, commercialToken, tenantKey, planTier) {
  return apiRequest(
    baseUrl,
    "POST",
    "/billing/internal/plan-tier",
    null,
    { tenantKey, planTier },
    {
      "x-pim-commercial-ops-token": commercialToken,
      "x-pim-operator-id": "ops-commercial",
      "x-pim-operator-role": "commercial_ops",
    },
  );
}

async function run() {
  prepareEnv();
  runMigrations();
  const apiBoot = resolveApiBootCommand();
  if (!fs.existsSync(apiBoot.requiredPath)) {
    throw new Error(`API boot entry not found at ${apiBoot.requiredPath}.`);
  }

  const runId = Date.now().toString();
  const apiPort = 5950 + Math.floor(Math.random() * 100);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantId = `readiness-access-${runId}`;
  const workspaceSlug = `ra-${runId}`.slice(0, 24);
  const adminUser = `ra-admin-${runId}`;
  const productAdminUser = `ra-product-admin-${runId}`;
  const systemAdminUser = `ra-system-admin-${runId}`;
  const reviewerUser = `ra-reviewer-${runId}`;
  const viewerUser = `ra-viewer-${runId}`;
  const authPassword = "vexa-pim-demo-password";
  const commercialToken = `commercial-ops-${runId}`;

  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [adminUser]: { tenantId, role: "admin", workspaceSlug },
      [productAdminUser]: { tenantId, role: "admin", workspaceSlug, assignedRoles: ["product_admin"] },
      [systemAdminUser]: { tenantId, role: "admin", workspaceSlug, assignedRoles: ["system_admin"] },
      [reviewerUser]: { tenantId, role: "reviewer", workspaceSlug },
      [viewerUser]: { tenantId, role: "viewer", workspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId, displayName: "Marketplace Readiness Runtime Access" },
    }),
    PIM_AUTH_PASSWORD: authPassword,
    PIM_COMMERCIAL_OPS_TOKEN: commercialToken,
    PIM_ACCESS_POLICY_SHADOW_MODE: "true",
    ...apiBoot.extraEnv,
  };

  const stdoutBuffer = [];
  const stderrBuffer = [];
  const apiProcess = spawn(apiBoot.command, apiBoot.args, {
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
  const apiExitPromise = createProcessExitPromise(apiProcess);

  try {
    try {
      const healthResult = await Promise.race([
        waitForHealth(baseUrl, getBootTimeoutMs()).then(() => ({ kind: "healthy" })),
        apiExitPromise.then((exit) => ({ kind: "exit", exit })),
      ]);
      if (healthResult.kind === "exit") {
        throw new Error(
          `API process exited before health check passed (code=${String(healthResult.exit.code)}, signal=${String(healthResult.exit.signal)})`,
        );
      }
    } catch (error) {
      const details = [];
      if (stderrBuffer.length > 0) {
        details.push(`api stderr tail:\n${stderrBuffer.slice(-40).join("")}`);
      }
      if (stdoutBuffer.length > 0) {
        details.push(`api stdout tail:\n${stdoutBuffer.slice(-40).join("")}`);
      }
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(details.length > 0 ? `${message}\n${details.join("\n")}` : message);
    }

    const adminLogin = await login(baseUrl, workspaceSlug, adminUser, authPassword);
    assertStatus(adminLogin, 201, "admin login");
    const adminToken = String(adminLogin.payload?.accessToken ?? "");
    assert(adminToken.length > 10, "missing admin token");

    const productAdminLogin = await login(baseUrl, workspaceSlug, productAdminUser, authPassword);
    assertStatus(productAdminLogin, 201, "product admin login");
    const productAdminToken = String(productAdminLogin.payload?.accessToken ?? "");
    assert(productAdminToken.length > 10, "missing product admin token");

    const systemAdminLogin = await login(baseUrl, workspaceSlug, systemAdminUser, authPassword);
    assertStatus(systemAdminLogin, 201, "system admin login");
    const systemAdminToken = String(systemAdminLogin.payload?.accessToken ?? "");
    assert(systemAdminToken.length > 10, "missing system admin token");

    const reviewerLogin = await login(baseUrl, workspaceSlug, reviewerUser, authPassword);
    assertStatus(reviewerLogin, 201, "reviewer login");
    const reviewerToken = String(reviewerLogin.payload?.accessToken ?? "");
    assert(reviewerToken.length > 10, "missing reviewer token");

    const viewerLogin = await login(baseUrl, workspaceSlug, viewerUser, authPassword);
    assertStatus(viewerLogin, 201, "viewer login");
    const viewerToken = String(viewerLogin.payload?.accessToken ?? "");
    assert(viewerToken.length > 10, "missing viewer token");

    const setEnterprise = await commercialPlanRequest(baseUrl, commercialToken, tenantId, "ENTERPRISE");
    assert(
      setEnterprise.status === 200 || setEnterprise.status === 201,
      `set enterprise plan failed: got ${setEnterprise.status} payload=${JSON.stringify(setEnterprise.payload)}`,
    );

    const category = await apiRequest(baseUrl, "POST", "/taxonomy/categories", adminToken, {
      name: `Runtime Access Category ${runId}`,
    });
    assertStatus(category, 201, "create category");

    const product = await apiRequest(baseUrl, "POST", "/catalog/products", adminToken, {
      title: `Runtime Access Product ${runId}`,
      brand: "Vexa PIM",
      description: "Marketplace readiness runtime access contract",
      categoryId: category.payload.id,
      status: "draft",
      attributes: {},
    });
    assertStatus(product, 201, "create product");

    const productAdminSimulationAllowed = await apiRequest(
      baseUrl,
      "GET",
      `/marketplace/products/${encodeURIComponent(product.payload.id)}/simulate?channel=amazon`,
      productAdminToken,
    );
    assertStatus(productAdminSimulationAllowed, 200, "product admin allowed marketplace simulation");

    const reviewerSimulationAllowed = await apiRequest(
      baseUrl,
      "GET",
      `/marketplace/products/${encodeURIComponent(product.payload.id)}/simulate?channel=amazon`,
      reviewerToken,
    );
    assertStatus(reviewerSimulationAllowed, 200, "reviewer allowed marketplace simulation");
    assert(
      String(reviewerSimulationAllowed.payload?.productId ?? "") === product.payload.id,
      `expected reviewer simulation payload, got ${JSON.stringify(reviewerSimulationAllowed.payload)}`,
    );

    const viewerSimulationAllowed = await apiRequest(
      baseUrl,
      "GET",
      `/marketplace/products/${encodeURIComponent(product.payload.id)}/simulate?channel=amazon`,
      viewerToken,
    );
    assertStatus(viewerSimulationAllowed, 200, "viewer allowed marketplace simulation");
    assert(
      String(viewerSimulationAllowed.payload?.productId ?? "") === product.payload.id,
      `expected viewer simulation payload, got ${JSON.stringify(viewerSimulationAllowed.payload)}`,
    );

    const systemAdminSimulationDenied = await apiRequest(
      baseUrl,
      "GET",
      `/marketplace/products/${encodeURIComponent(product.payload.id)}/simulate?channel=amazon`,
      systemAdminToken,
    );
    assertStatus(systemAdminSimulationDenied, 403, "system admin denied marketplace simulation");
    assert(
      String(systemAdminSimulationDenied.payload?.reason ?? "") === "ADMIN_BOUNDARY_FORBIDDEN",
      `expected ADMIN_BOUNDARY_FORBIDDEN for system admin simulation, got ${JSON.stringify(systemAdminSimulationDenied.payload)}`,
    );

    const batchBody = {
      productIds: [product.payload.id],
      channels: ["amazon", "shopify"],
    };

    const productAdminBatchAllowed = await apiRequest(
      baseUrl,
      "POST",
      "/marketplace/readiness/batch",
      productAdminToken,
      batchBody,
    );
    assertStatus(productAdminBatchAllowed, 200, "product admin allowed marketplace batch readiness");

    const reviewerBatchAllowed = await apiRequest(baseUrl, "POST", "/marketplace/readiness/batch", reviewerToken, batchBody);
    assertStatus(reviewerBatchAllowed, 200, "reviewer allowed marketplace batch readiness");
    assert(
      Array.isArray(reviewerBatchAllowed.payload?.items) && reviewerBatchAllowed.payload.items.length === 1,
      `expected reviewer batch readiness payload, got ${JSON.stringify(reviewerBatchAllowed.payload)}`,
    );

    const viewerBatchAllowed = await apiRequest(baseUrl, "POST", "/marketplace/readiness/batch", viewerToken, batchBody);
    assertStatus(viewerBatchAllowed, 200, "viewer allowed marketplace batch readiness");
    assert(
      Array.isArray(viewerBatchAllowed.payload?.items) && viewerBatchAllowed.payload.items.length === 1,
      `expected viewer batch readiness payload, got ${JSON.stringify(viewerBatchAllowed.payload)}`,
    );

    const systemAdminBatchDenied = await apiRequest(
      baseUrl,
      "POST",
      "/marketplace/readiness/batch",
      systemAdminToken,
      batchBody,
    );
    assertStatus(systemAdminBatchDenied, 403, "system admin denied marketplace batch readiness");
    assert(
      String(systemAdminBatchDenied.payload?.reason ?? "") === "ADMIN_BOUNDARY_FORBIDDEN",
      `expected ADMIN_BOUNDARY_FORBIDDEN for system admin batch readiness, got ${JSON.stringify(systemAdminBatchDenied.payload)}`,
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          validated: [
            "product_admin_reviewer_and_viewer_allowed_marketplace_simulation",
            "system_admin_denied_marketplace_simulation",
            "product_admin_reviewer_and_viewer_allowed_marketplace_batch_readiness",
            "system_admin_denied_marketplace_batch_readiness",
          ],
          bootMode: apiBoot.mode,
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error("Marketplace readiness runtime access integration test failed:");
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
