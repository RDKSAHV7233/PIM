#!/usr/bin/env node
/* eslint-disable no-console */
// Verifies GET /marketplace/bulk-publish-runs actually filters by installationId at
// the database layer -- not just that the query param is accepted, but that rows
// belonging to a different installation of the SAME connector are excluded. This is
// the API-side half of the Jobs-page installation-scoping fix (see
// apps/web/test/integration/operations-jobs-route-contract.test.cjs for the UI half).
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");
const AUTH_PASSWORD = process.env.PIM_AUTH_PASSWORD || "vexa-pim-demo-password";
const COMMERCIAL_OPS_TOKEN = process.env.PIM_COMMERCIAL_OPS_TOKEN || "bulk-publish-runs-filter-test-ops-token";

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^"|"$/g, "");
    if (key && !process.env[key]) process.env[key] = value;
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
  setDefaultEnv("PIM_AUTH_REDIS_DISABLED", "true");
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "vexa-pim-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/vexa-pim-local");
  setDefaultEnv("APP_ENV", "development");
  setDefaultEnv("FEATURE_REAL_SPAPI_VALIDATION", "false");
  setDefaultEnv("PIM_COMMERCIAL_OPS_TOKEN", COMMERCIAL_OPS_TOKEN);
  // .env.example ships inline "# comment" suffixes on some values; the simple
  // readEnvFile parser above only strips a leading/trailing quote, so a line like
  // `AUTH_MODE="local" # local | db (...)` ends up with the comment text still
  // attached and fails strict enum validation on startup. Force-correct just the
  // handful of enum-typed keys this test actually needs, unconditionally (not via
  // setDefaultEnv, since readEnvFile already "set" them to the garbled value).
  process.env.AUTH_MODE = "local";
  process.env.ACCOUNT_EXPORT_STORAGE_MODE = "auto";
  process.env.FEATURE_PUBLIC_SIGNUP_ENABLED = "false";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`, { method: "GET" });
      if (response.ok) return;
    } catch {}
    await sleep(400);
  }
  throw new Error(`API did not become healthy at ${baseUrl}/health within ${timeoutMs}ms`);
}

async function apiRequest(baseUrl, method, route, token, body, extraHeaders) {
  const headers = { Accept: "application/json", ...(extraHeaders || {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const options = { method, headers, signal: AbortSignal.timeout(20_000) };
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

function assertStatus(result, expected, context) {
  if (result.status !== expected) {
    throw new Error(`${context} failed: expected ${expected}, got ${result.status}; payload=${JSON.stringify(result.payload)}`);
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const apiPort = 6900 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantId = `bulkpub-filter-${runId}`;
  const workspaceSlug = `bpf-${runId}`.slice(0, 24);
  const userId = `bulkpub-filter-user-${runId}`;
  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [userId]: { tenantId, role: "admin", workspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId, displayName: "Bulk Publish Filter Test" },
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
    if (stdoutBuffer.length > 200) stdoutBuffer.shift();
  });
  apiProcess.stderr.on("data", (chunk) => {
    stderrBuffer.push(String(chunk));
    if (stderrBuffer.length > 200) stderrBuffer.shift();
  });

  try {
    await waitForHealth(baseUrl, 60_000);

    const login = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      workspaceSlug,
      userId,
      password: AUTH_PASSWORD,
      expiresInMinutes: 30,
    });
    assertStatus(login, 201, "login");
    const token = String(login.payload?.accessToken ?? "");

    // STARTER tier only allows 1 account per connector -- bump to GROWTH (3 allowed)
    // so this test can install two Shopify accounts under the same tenant, the exact
    // scenario the fix is for.
    const planTierChange = await apiRequest(
      baseUrl,
      "POST",
      "/billing/internal/plan-tier",
      null,
      { tenantKey: tenantId, planTier: "GROWTH" },
      {
        "x-pim-commercial-ops-token": COMMERCIAL_OPS_TOKEN,
        "x-pim-operator-id": "bulk-publish-runs-filter-test",
        "x-pim-operator-role": "admin",
      },
    );
    assert([200, 201].includes(planTierChange.status), `set plan tier to GROWTH failed: ${planTierChange.status} ${JSON.stringify(planTierChange.payload)}`);

    const installationA = await apiRequest(baseUrl, "POST", "/connectors/shopify/install", token, {
      accountAlias: `store-a-${runId}`.slice(0, 40),
      shopDomain: "store-a.myshopify.com",
    });
    assertStatus(installationA, 201, "install shopify store A");

    const installationB = await apiRequest(baseUrl, "POST", "/connectors/shopify/install", token, {
      accountAlias: `store-b-${runId}`.slice(0, 40),
      shopDomain: "store-b.myshopify.com",
    });
    assertStatus(installationB, 201, "install shopify store B");

    const installationAId = String(installationA.payload.id);
    const installationBId = String(installationB.payload.id);
    assert(installationAId !== installationBId, "expected two distinct installation ids");

    const category = await apiRequest(baseUrl, "POST", "/taxonomy/categories", token, {
      name: `Bulk Publish Filter Category ${runId}`,
    });
    assertStatus(category, 201, "create category");

    const product = await apiRequest(baseUrl, "POST", "/catalog/products", token, {
      title: `Bulk Publish Filter Product ${runId}`,
      brand: "Vexa PIM",
      description: "bulk publish installation filter coverage",
      categoryId: category.payload.id,
      status: "draft",
      hsnCode: "62046200",
      gstRate: 18,
      attributes: {},
    });
    assertStatus(product, 201, "create product");

    const submitForReview = await apiRequest(baseUrl, "PATCH", `/catalog/products/${product.payload.id}`, token, {
      status: "in_review",
      expectedVersion: 1,
    });
    assert([200, 201].includes(submitForReview.status), `submit product for review failed: ${submitForReview.status} ${JSON.stringify(submitForReview.payload)}`);

    const approval = await apiRequest(baseUrl, "POST", `/catalog/products/${product.payload.id}/review-decision`, token, {
      status: "approved",
      note: "bulk publish installation filter coverage",
    });
    assert([200, 201].includes(approval.status), `approve product failed: ${approval.status} ${JSON.stringify(approval.payload)}`);

    // Trigger a bulk-publish run against each installation so both exist in the same
    // tenant's MarketplaceBulkPublishRun table, differing only by installationId.
    const runA = await apiRequest(baseUrl, "POST", `/marketplace/connectors/${installationAId}/bulk-publish`, token, {
      productIds: [product.payload.id],
    });
    assert([200, 201, 202].includes(runA.status), `trigger bulk-publish for store A failed: ${runA.status} ${JSON.stringify(runA.payload)}`);

    const runB = await apiRequest(baseUrl, "POST", `/marketplace/connectors/${installationBId}/bulk-publish`, token, {
      productIds: [product.payload.id],
    });
    assert([200, 201, 202].includes(runB.status), `trigger bulk-publish for store B failed: ${runB.status} ${JSON.stringify(runB.payload)}`);

    // Unfiltered list must include runs from BOTH installations.
    const unfiltered = await apiRequest(baseUrl, "GET", "/marketplace/bulk-publish-runs?limit=50", token);
    assertStatus(unfiltered, 200, "list bulk-publish-runs unfiltered");
    const unfilteredItems = Array.isArray(unfiltered.payload) ? unfiltered.payload : (unfiltered.payload.items ?? []);
    const unfilteredInstallationIds = new Set(unfilteredItems.map((run) => run.installationId));
    assert(unfilteredInstallationIds.has(installationAId), "unfiltered list must include store A's run");
    assert(unfilteredInstallationIds.has(installationBId), "unfiltered list must include store B's run");

    // Filtered by installationId=A must include ONLY store A's runs.
    const filteredA = await apiRequest(baseUrl, "GET", `/marketplace/bulk-publish-runs?limit=50&installationId=${installationAId}`, token);
    assertStatus(filteredA, 200, "list bulk-publish-runs filtered to store A");
    const filteredAItems = Array.isArray(filteredA.payload) ? filteredA.payload : (filteredA.payload.items ?? []);
    assert(filteredAItems.length > 0, "filtered list for store A must not be empty");
    assert(
      filteredAItems.every((run) => run.installationId === installationAId),
      "filtered list for store A must not leak store B's runs",
    );

    // Same check with cursor pagination mode, since listBulkPublishRuns has two code paths.
    const filteredACursor = await apiRequest(
      baseUrl,
      "GET",
      `/marketplace/bulk-publish-runs?limit=50&installationId=${installationAId}&pagination=cursor`,
      token,
    );
    assertStatus(filteredACursor, 200, "list bulk-publish-runs filtered to store A (cursor mode)");
    const filteredACursorItems = filteredACursor.payload.items ?? [];
    assert(filteredACursorItems.length > 0, "cursor-mode filtered list for store A must not be empty");
    assert(
      filteredACursorItems.every((run) => run.installationId === installationAId),
      "cursor-mode filtered list for store A must not leak store B's runs",
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          validated: [
            "bulk_publish_runs_unfiltered_list_includes_all_installations",
            "bulk_publish_runs_installation_filter_excludes_other_installations",
            "bulk_publish_runs_installation_filter_works_under_cursor_pagination",
          ],
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error("Bulk publish runs installation filter integration test failed:");
    console.error(error instanceof Error ? error.message : String(error));
    const stderr = stderrBuffer.join("");
    if (stderr.trim()) {
      console.error("--- api stderr tail ---");
      console.error(stderr.slice(-4000));
    }
    process.exitCode = 1;
  } finally {
    apiProcess.kill("SIGTERM");
    await sleep(500);
  }
}

run().catch((error) => {
  console.error("Bulk publish runs installation filter integration test crashed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
