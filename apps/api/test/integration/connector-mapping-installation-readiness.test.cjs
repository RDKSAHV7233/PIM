#!/usr/bin/env node
/* eslint-disable no-console */
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
    throw new Error(`${context} failed: expected ${expected}, got ${result.status} payload=${JSON.stringify(result.payload)}`);
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
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const apiPort = 6900 + Math.floor(Math.random() * 150);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenant = `mapping-install-readiness-${runId}`;
  const workspaceSlug = `mir-${runId}`.slice(0, 24);
  const userId = `mapping-install-user-${runId}`;
  const commercialToken = `commercial-ops-${runId}`;

  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenant,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [userId]: { tenantId: tenant, role: "admin", workspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId: tenant, displayName: "Mapping Installation Readiness" },
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

    const category = await apiRequest(baseUrl, "POST", "/taxonomy/categories", token, {
      name: `Installation Readiness Category ${runId}`,
    });
    assertStatus(category, 201, "create category");
    const categoryId = String(category.payload.id);

    const createDraft = await apiRequest(
      baseUrl,
      "POST",
      "/marketplace/connectors/flipkart/mappings/versions",
      token,
      {
        categoryScope: "*",
        mappingLevel: "tenant_connector_default",
        connectorDefinitionId: "flipkart",
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
        fallbackPolicy: {
          enabled: true,
          warning_tag: "fallback_category_mapping",
        },
        fallbackAckRequired: false,
      },
    );
    assertStatus(createDraft, 201, "create mapping draft");
    const versionId = String(createDraft.payload.id);

    const validateVersion = await apiRequest(
      baseUrl,
      "POST",
      `/marketplace/connectors/flipkart/mappings/versions/${encodeURIComponent(versionId)}/validate`,
      token,
      {},
    );
    assertStatus(validateVersion, 201, "validate mapping version");

    const stepUpToken = await issueStepUp(baseUrl, token);
    const publishVersion = await apiRequest(
      baseUrl,
      "POST",
      `/marketplace/connectors/flipkart/mappings/versions/${encodeURIComponent(versionId)}/publish`,
      token,
      { confirm: true },
      { [STEP_UP_HEADER]: stepUpToken },
    );
    assertStatus(publishVersion, 201, "publish mapping version");

    const installActive = await apiRequest(baseUrl, "POST", "/connectors/flipkart/install", token, {
      accountAlias: `active-${runId}`,
      externalAccountRef: `merchant-active-${runId}`,
    });
    assertStatus(installActive, 201, "install active connector");
    const activeInstallationId = String(installActive.payload.id);

    const installDisabled = await apiRequest(baseUrl, "POST", "/connectors/flipkart/install", token, {
      accountAlias: `disabled-${runId}`,
      externalAccountRef: `merchant-disabled-${runId}`,
    });
    assertStatus(installDisabled, 201, "install disabled connector");
    const disabledInstallationId = String(installDisabled.payload.id);

    const disableInstallation = await apiRequest(
      baseUrl,
      "POST",
      `/connectors/${encodeURIComponent(disabledInstallationId)}/uninstall`,
      token,
      {},
    );
    assertStatus(disableInstallation, 201, "disable connector installation");

    const defaultReadiness = await apiRequest(
      baseUrl,
      "POST",
      "/marketplace/connectors/flipkart/publish-readiness",
      token,
      {
        categoryScope: categoryId,
        fallbackAcknowledged: false,
      },
    );
    assertStatus(defaultReadiness, 201, "default publish readiness");
    assert(
      Array.isArray(defaultReadiness.payload?.warnings) &&
        defaultReadiness.payload.warnings.includes("connector_not_active"),
      "default readiness should follow the latest disabled installation when no installationId is provided",
    );
    assert(
      String(defaultReadiness.payload?.checks?.installation?.id ?? "") === disabledInstallationId,
      "default readiness must report the latest disabled installation id",
    );

    const activeReadiness = await apiRequest(
      baseUrl,
      "POST",
      "/marketplace/connectors/flipkart/publish-readiness",
      token,
      {
        categoryScope: categoryId,
        installationId: activeInstallationId,
        fallbackAcknowledged: false,
      },
    );
    assertStatus(activeReadiness, 201, "active installation readiness");
    assert(
      !Array.isArray(activeReadiness.payload?.warnings) ||
        !activeReadiness.payload.warnings.includes("connector_not_active"),
      "selected active installation should not inherit disabled-installation warning",
    );
    assert(
      String(activeReadiness.payload?.checks?.installation?.id ?? "") === activeInstallationId,
      "active readiness must report the selected active installation id",
    );

    const disabledReadiness = await apiRequest(
      baseUrl,
      "POST",
      "/marketplace/connectors/flipkart/publish-readiness",
      token,
      {
        categoryScope: categoryId,
        installationId: disabledInstallationId,
        fallbackAcknowledged: false,
      },
    );
    assertStatus(disabledReadiness, 201, "disabled installation readiness");
    assert(
      Array.isArray(disabledReadiness.payload?.warnings) &&
        disabledReadiness.payload.warnings.includes("connector_not_active"),
      "selected disabled installation should surface connector_not_active warning",
    );
    assert(
      String(disabledReadiness.payload?.checks?.installation?.id ?? "") === disabledInstallationId,
      "disabled readiness must report the selected disabled installation id",
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          versionId,
          activeInstallationId,
          disabledInstallationId,
          validated: [
            "default_readiness_uses_latest_installation_when_unspecified",
            "selected_installation_drives_publish_readiness",
            "readiness_reports_selected_installation_context",
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
  console.error("[connector-mapping-installation-readiness.test] FAILED");
  console.error(error);
  process.exitCode = 1;
});
