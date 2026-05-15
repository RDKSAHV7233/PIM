#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Regression test: buildSimulationFromProduct must resolve ConnectorMappingVersion when
 * no channelMappingTemplate exists for the tenant.
 *
 * Sprint 11 introduced ConnectorMappingVersion as the authoritative mapping source.
 * A prior bug caused the simulation path (called by processExportJob and the simulate
 * endpoint) to silently fall back to system defaults when the tenant had published a
 * ConnectorMappingVersion but had no legacy channelMappingTemplate record. This test
 * proves the bridge is working: simulation resolves the mapping and reports
 * mappingSource === "connector_mapping_version".
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");
const STEP_UP_HEADER = "x-pim-step-up-token";
const STEP_UP_SCOPE = "mapping_high_risk";

function getAuthPassword() {
  return process.env.PIM_AUTH_PASSWORD || "vexa-pim-demo-password";
}

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || /^\s*#/.test(line)) {
      continue;
    }
    const index = line.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^"|"$/g, "");
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
      // retry
    }
    await sleep(400);
  }
  throw new Error(`API did not become healthy at ${baseUrl}/health within ${timeoutMs}ms`);
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

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertStatus(result, expected, context) {
  if (result.status !== expected) {
    throw new Error(
      `${context} failed: expected ${expected}, got ${result.status} payload=${JSON.stringify(result.payload)}`,
    );
  }
}

async function issueStepUp(baseUrl, token) {
  const result = await apiRequest(baseUrl, "POST", "/auth/step-up", token, {
    password: getAuthPassword(),
    scope: STEP_UP_SCOPE,
  });
  assertStatus(result, 201, "issue step-up token");
  const stepUpToken = String(result.payload?.stepUpToken ?? "");
  assert(stepUpToken.length > 10, "missing step-up token");
  return stepUpToken;
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(
      `API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`,
    );
  }

  const runId = Date.now().toString();
  const apiPort = 6900 + Math.floor(Math.random() * 150);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenant = `mapping-sim-bridge-${runId}`;
  const workspaceSlug = `msb-${runId}`.slice(0, 24);
  const userId = `mapping-sim-bridge-user-${runId}`;
  const commercialToken = `commercial-ops-${runId}`;
  const connectorSlug = "flipkart";

  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenant,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [userId]: { tenantId: tenant, role: "admin", workspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId: tenant, displayName: "Mapping Simulation Bridge" },
    }),
    PIM_COMMERCIAL_OPS_TOKEN: commercialToken,
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
      userId,
      workspaceSlug,
      password: getAuthPassword(),
      expiresInMinutes: 30,
    });
    assertStatus(login, 201, "login");
    const token = String(login.payload?.accessToken ?? "");
    assert(token.length > 10, "missing access token");

    const setEnterprise = await commercialPlanRequest(baseUrl, commercialToken, tenant, "ENTERPRISE");
    assert(
      setEnterprise.status === 200 || setEnterprise.status === 201,
      `set enterprise plan failed: expected 200/201, got ${setEnterprise.status} payload=${JSON.stringify(setEnterprise.payload)}`,
    );

    // Create category and product
    const category = await apiRequest(baseUrl, "POST", "/taxonomy/categories", token, {
      name: `Bridge Test Category ${runId}`,
    });
    assertStatus(category, 201, "create category");
    const categoryId = String(category.payload.id);

    const product = await apiRequest(baseUrl, "POST", "/catalog/products", token, {
      title: `Bridge Test Product ${runId}`,
      sku: `bridge-sku-${runId}`,
      brand: "Bridge Brand",
      categoryId,
      sellingPrice: 199,
      mrp: 299,
      description: "Test product for ConnectorMappingVersion simulation bridge regression",
    });
    assertStatus(product, 201, "create product");
    const productId = String(product.payload.id);

    // Install connector
    const install = await apiRequest(baseUrl, "POST", `/connectors/${connectorSlug}/install`, token, {
      accountAlias: `bridge-${runId}`,
      externalAccountRef: `merchant-bridge-${runId}`,
    });
    assertStatus(install, 201, "install connector");
    const installationId = String(install.payload.id);

    // Publish a ConnectorMappingVersion (slug-scoped default — no channelMappingTemplate exists for this tenant)
    const createDraft = await apiRequest(
      baseUrl,
      "POST",
      `/marketplace/connectors/${connectorSlug}/mappings/versions`,
      token,
      {
        categoryScope: "*",
        mappingLevel: "tenant_connector_default",
        connectorDefinitionId: connectorSlug,
        connectorDefinitionVersion: "1.0.0",
        compatibilityState: "compatible",
        mappingRules: {
          field_mappings: {
            title: "product_title",
            brand: "brand",
            description: "description",
            hsnCode: "hsn_code",
            gstRate: "gst_rate",
          },
        },
        fallbackPolicy: { enabled: false },
        fallbackAckRequired: false,
      },
    );
    assertStatus(createDraft, 201, "create mapping draft");
    const versionId = String(createDraft.payload.id);

    const validateVersion = await apiRequest(
      baseUrl,
      "POST",
      `/marketplace/connectors/${connectorSlug}/mappings/versions/${encodeURIComponent(versionId)}/validate`,
      token,
      {},
    );
    assertStatus(validateVersion, 201, "validate mapping version");

    const stepUpToken = await issueStepUp(baseUrl, token);
    const publishVersion = await apiRequest(
      baseUrl,
      "POST",
      `/marketplace/connectors/${connectorSlug}/mappings/versions/${encodeURIComponent(versionId)}/publish`,
      token,
      { confirm: true },
      { [STEP_UP_HEADER]: stepUpToken },
    );
    assertStatus(publishVersion, 201, "publish mapping version");

    // --- Test 1: simulate endpoint resolves ConnectorMappingVersion ---
    // No channelMappingTemplate exists for this tenant — only the ConnectorMappingVersion published above.
    // The bridge in getEffectiveMapping must fall back to resolveEffectiveMapping and return
    // mappingSource === "connector_mapping_version".
    const simulateResult = await apiRequest(
      baseUrl,
      "POST",
      `/marketplace/products/${encodeURIComponent(productId)}/simulate`,
      token,
      { channel: "flipkart", installationId },
    );
    assertStatus(simulateResult, 201, "simulate product");

    const mappingSource = String(simulateResult.payload?.mappingSource ?? "");
    assert(
      mappingSource === "connector_mapping_version",
      `expected mappingSource="connector_mapping_version" but got "${mappingSource}" — bridge from buildSimulationFromProduct to ConnectorMappingVersion is broken`,
    );

    // --- Test 2: publish-readiness resolves the same mapping ---
    // evaluatePublishReadiness also calls resolveEffectiveMapping. Verify it finds the mapping
    // and does not emit mapping_not_configured blocker.
    const readiness = await apiRequest(
      baseUrl,
      "POST",
      `/marketplace/connectors/${connectorSlug}/publish-readiness`,
      token,
      { categoryScope: categoryId, installationId, fallbackAcknowledged: false },
    );
    assertStatus(readiness, 201, "evaluate publish readiness");

    const blockers = readiness.payload?.blockers ?? [];
    assert(
      !blockers.includes("mapping_not_configured"),
      `publish-readiness emitted mapping_not_configured — ConnectorMappingVersion not resolved for installationId=${installationId}`,
    );

    // --- Test 3: simulate without installationId also resolves ConnectorMappingVersion ---
    // The slug-scoped default should be found even when no installationId is specified,
    // proving legacy call sites (e.g. processExportJob before the bridge) also benefit.
    const simulateNoInstall = await apiRequest(
      baseUrl,
      "POST",
      `/marketplace/products/${encodeURIComponent(productId)}/simulate`,
      token,
      { channel: "flipkart" },
    );
    assertStatus(simulateNoInstall, 201, "simulate product without installationId");

    const mappingSourceNoInstall = String(simulateNoInstall.payload?.mappingSource ?? "");
    assert(
      mappingSourceNoInstall === "connector_mapping_version",
      `simulate without installationId returned mappingSource="${mappingSourceNoInstall}" — slug-scoped ConnectorMappingVersion not resolved`,
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          productId,
          installationId,
          versionId,
          validated: [
            "simulate_with_installationId_resolves_connector_mapping_version",
            "publish_readiness_no_mapping_not_configured_blocker",
            "simulate_without_installationId_resolves_slug_scoped_connector_mapping_version",
          ],
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } finally {
    if (!apiProcess.killed) {
      apiProcess.kill("SIGTERM");
    }
    await sleep(500);
    if (!apiProcess.killed) {
      apiProcess.kill("SIGKILL");
    }
  }
}

run().catch((error) => {
  console.error("[connector-mapping-version-simulation-bridge.test] FAILED");
  console.error(error);
  process.exitCode = 1;
});
