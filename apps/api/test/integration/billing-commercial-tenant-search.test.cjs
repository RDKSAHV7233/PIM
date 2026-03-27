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
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "tej-pim-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/tej-pim-local");
  setDefaultEnv("APP_ENV", "development");
  setDefaultEnv("AUTH_MODE", "db");
  setDefaultEnv("PIM_DEFAULT_ROLE", "admin");
  setDefaultEnv("FEATURE_REAL_SPAPI_VALIDATION", "false");
  setDefaultEnv("PIM_AUTH_PASSWORD", "tej-pim-demo-password");
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

async function apiRequest(baseUrl, method, route, body, extraHeaders) {
  const headers = { Accept: "application/json", ...(extraHeaders ?? {}) };
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

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const apiPort = 6420 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const platformToken = `platform-search-${runId}`;
  const commercialToken = `commercial-search-${runId}`;
  const tenantId = `search-tenant-${runId}`;
  const workspaceSlug = `ops-${runId}`.slice(0, 24);
  const displayName = `Ops Search Workspace ${runId}`;
  const adminUser = `ops-search-admin-${runId}@example.com`;
  const secondTenantId = `search-other-${runId}`;
  const secondWorkspaceSlug = `ops-other-${runId}`.slice(0, 24);
  const secondDisplayName = `Distractor Workspace ${runId}`;
  const secondAdminUser = `ops-search-other-${runId}@example.com`;
  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_PLATFORM_ADMIN_TOKEN: platformToken,
    PIM_COMMERCIAL_OPS_TOKEN: commercialToken,
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_AUTH_IDENTITIES_JSON: "",
    PIM_AUTH_WORKSPACES_JSON: "",
    PIM_AUTH_PASSWORD: "tej-pim-demo-password",
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

    const provisionPrimary = await apiRequest(
      baseUrl,
      "POST",
      "/platform/tenants",
      {
        tenantKey: tenantId,
        workspaceSlug,
        displayName,
        initialAdminUserId: adminUser,
      },
      { "x-pim-platform-admin-token": platformToken },
    );
    assertStatus(provisionPrimary, 201, "primary platform tenant provisioning");

    const provisionSecondary = await apiRequest(
      baseUrl,
      "POST",
      "/platform/tenants",
      {
        tenantKey: secondTenantId,
        workspaceSlug: secondWorkspaceSlug,
        displayName: secondDisplayName,
        initialAdminUserId: secondAdminUser,
      },
      { "x-pim-platform-admin-token": platformToken },
    );
    assertStatus(provisionSecondary, 201, "secondary platform tenant provisioning");

    const planUpdate = await apiRequest(
      baseUrl,
      "POST",
      "/billing/internal/plan-tier",
      {
        tenantKey: tenantId,
        planTier: "ENTERPRISE",
      },
      {
        "x-pim-commercial-ops-token": commercialToken,
        "x-pim-operator-id": "ops-commercial",
        "x-pim-operator-role": "commercial_ops",
      },
    );
    assert(planUpdate.status === 200 || planUpdate.status === 201, `plan update failed payload=${JSON.stringify(planUpdate.payload)}`);

    const graceEndsAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString();
    const billingContactEmail = `billing-search-${runId}@example.com`;
    const commercialUpdate = await apiRequest(
      baseUrl,
      "POST",
      "/billing/internal/commercial-state",
      {
        tenantKey: tenantId,
        billingStatus: "past_due",
        accessStatus: "suspended",
        graceEndsAt,
        billingContactEmail,
        suspensionReason: "ops_search_validation",
      },
      {
        "x-pim-commercial-ops-token": commercialToken,
        "x-pim-operator-id": "ops-commercial",
        "x-pim-operator-role": "commercial_ops",
      },
    );
    assert(
      commercialUpdate.status === 200 || commercialUpdate.status === 201,
      `commercial update failed payload=${JSON.stringify(commercialUpdate.payload)}`,
    );

    const missingToken = await apiRequest(
      baseUrl,
      "GET",
      `/billing/internal/tenants/search?q=${encodeURIComponent(workspaceSlug)}`,
      undefined,
      undefined,
    );
    assertStatus(missingToken, 401, "tenant search requires token");
    assert(
      String(missingToken.payload?.error ?? "") === "COMMERCIAL_OPS_TOKEN_REQUIRED",
      `expected COMMERCIAL_OPS_TOKEN_REQUIRED payload=${JSON.stringify(missingToken.payload)}`,
    );

    const missingOperator = await apiRequest(
      baseUrl,
      "GET",
      `/billing/internal/tenants/search?q=${encodeURIComponent(workspaceSlug)}`,
      undefined,
      { "x-pim-commercial-ops-token": commercialToken },
    );
    assertStatus(missingOperator, 400, "tenant search requires operator identity");
    assert(
      String(missingOperator.payload?.error ?? "") === "COMMERCIAL_OPERATOR_ID_REQUIRED",
      `expected COMMERCIAL_OPERATOR_ID_REQUIRED payload=${JSON.stringify(missingOperator.payload)}`,
    );

    const queries = [
      { label: "workspace slug", value: workspaceSlug },
      { label: "display name", value: "Ops Search Workspace" },
      { label: "tenant key", value: tenantId },
      { label: "admin email", value: adminUser },
    ];

    for (const query of queries) {
      const result = await apiRequest(
        baseUrl,
        "GET",
        `/billing/internal/tenants/search?q=${encodeURIComponent(query.value)}&limit=5`,
        undefined,
        {
          "x-pim-commercial-ops-token": commercialToken,
          "x-pim-operator-id": "ops-commercial",
          "x-pim-operator-role": "commercial_ops",
        },
      );
      assertStatus(result, 200, `tenant search by ${query.label}`);
      assert(Number(result.payload?.count ?? 0) >= 1, `expected at least one search result payload=${JSON.stringify(result.payload)}`);
      const first = Array.isArray(result.payload?.items) ? result.payload.items[0] : null;
      assert(first, `expected search results array payload=${JSON.stringify(result.payload)}`);
      assert(String(first.tenantKey ?? "") === tenantId, `expected target tenant first for ${query.label} payload=${JSON.stringify(first)}`);
      assert(String(first.workspaceSlug ?? "") === workspaceSlug, `unexpected workspaceSlug for ${query.label} payload=${JSON.stringify(first)}`);
      assert(String(first.displayName ?? "") === displayName, `unexpected displayName for ${query.label} payload=${JSON.stringify(first)}`);
      assert(Boolean(first.workspaceIsActive) === true, `expected workspaceIsActive=true payload=${JSON.stringify(first)}`);
      assert(String(first.planTier ?? "") === "ENTERPRISE", `expected ENTERPRISE plan payload=${JSON.stringify(first)}`);
      assert(String(first.billingStatus ?? "") === "past_due", `expected past_due billing payload=${JSON.stringify(first)}`);
      assert(String(first.accessStatus ?? "") === "suspended", `expected suspended access payload=${JSON.stringify(first)}`);
      assert(String(first.suspensionReason ?? "") === "ops_search_validation", `expected suspension reason payload=${JSON.stringify(first)}`);
      assert(
        String(first.graceEndsAt ?? "") === graceEndsAt,
        `expected graceEndsAt to round-trip through search payload=${JSON.stringify(first)}`,
      );
      assert(
        String(first.billingContactEmail ?? "") === billingContactEmail,
        `expected billingContactEmail to round-trip through search payload=${JSON.stringify(first)}`,
      );
      assert(
        Array.isArray(first.adminEmails) && first.adminEmails.includes(adminUser),
        `expected active admin email in search payload=${JSON.stringify(first)}`,
      );
    }

    const exportAll = await apiRequest(
      baseUrl,
      "GET",
      "/billing/internal/tenants/export?limit=10",
      undefined,
      {
        Accept: "text/csv",
        "x-pim-commercial-ops-token": commercialToken,
        "x-pim-operator-id": "ops-commercial",
        "x-pim-operator-role": "commercial_ops",
      },
    );
    assertStatus(exportAll, 200, "tenant export across all tenants");
    const exportAllCsv = String(exportAll.payload ?? "");
    assert(
      exportAllCsv.includes("tenantKey,workspaceSlug,displayName,workspaceIsActive,planTier,billingStatus,accessStatus"),
      `expected tenant export csv header payload=${exportAllCsv}`,
    );
    assert(
      exportAllCsv.includes(`"${tenantId}"`) &&
        exportAllCsv.includes(`"${secondTenantId}"`) &&
        exportAllCsv.includes(`"${billingContactEmail}"`) &&
        exportAllCsv.includes('"ops_search_validation"'),
      `expected both tenants and commercial state in export payload=${exportAllCsv}`,
    );

    const exportFiltered = await apiRequest(
      baseUrl,
      "GET",
      `/billing/internal/tenants/export?q=${encodeURIComponent(workspaceSlug)}&limit=10`,
      undefined,
      {
        Accept: "text/csv",
        "x-pim-commercial-ops-token": commercialToken,
        "x-pim-operator-id": "ops-commercial",
        "x-pim-operator-role": "commercial_ops",
      },
    );
    assertStatus(exportFiltered, 200, "filtered tenant export");
    const exportFilteredCsv = String(exportFiltered.payload ?? "");
    assert(
      exportFilteredCsv.includes(`"${tenantId}"`) &&
        exportFilteredCsv.includes(`"${workspaceSlug}"`) &&
        !exportFilteredCsv.includes(`"${secondTenantId}"`),
      `expected filtered tenant export to narrow to the matching workspace payload=${exportFilteredCsv}`,
    );

    const shortQuery = await apiRequest(
      baseUrl,
      "GET",
      "/billing/internal/tenants/search?q=o",
      undefined,
      {
        "x-pim-commercial-ops-token": commercialToken,
        "x-pim-operator-id": "ops-commercial",
        "x-pim-operator-role": "commercial_ops",
      },
    );
    assertStatus(shortQuery, 400, "tenant search rejects too-short queries");
    assert(
      String(shortQuery.payload?.error ?? "") === "TENANT_SEARCH_QUERY_TOO_SHORT",
      `expected TENANT_SEARCH_QUERY_TOO_SHORT payload=${JSON.stringify(shortQuery.payload)}`,
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantId,
          validated: [
            "tenant_search_requires_commercial_ops_token",
            "tenant_search_requires_operator_identity",
            "tenant_search_matches_workspace_slug",
            "tenant_search_matches_display_name",
            "tenant_search_matches_tenant_key",
            "tenant_search_matches_admin_email",
            "tenant_search_returns_current_commercial_state",
            "tenant_export_returns_all_or_filtered_commercial_rows",
            "tenant_search_rejects_too_short_queries",
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
    console.error("Billing commercial tenant search integration test failed:");
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
    if (apiProcess.pid) {
      try {
        if (process.platform === "win32") {
          execFileSync("taskkill", ["/pid", String(apiProcess.pid), "/t", "/f"], { stdio: "ignore" });
        } else {
          apiProcess.kill("SIGTERM");
        }
      } catch {
        // ignore cleanup failures
      }
    }
  }
}

run();
