#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");
const STEP_UP_HEADER = "x-pim-step-up-token";
const STEP_UP_SCOPE = "mapping_high_risk";

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
    password: "tej-pim-demo-password",
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
  const apiPort = 6700 + Math.floor(Math.random() * 200);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantA = `mapping-lifecycle-a-${runId}`;
  const tenantB = `mapping-lifecycle-b-${runId}`;
  const workspaceSlugA = `mapa-${runId}`.slice(0, 24);
  const workspaceSlugB = `mapb-${runId}`.slice(0, 24);
  const userA = `mapping-user-a-${runId}`;
  const userB = `mapping-user-b-${runId}`;

  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantA,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [userA]: { tenantId: tenantA, role: "admin", workspaceSlug: workspaceSlugA },
      [userB]: { tenantId: tenantB, role: "admin", workspaceSlug: workspaceSlugB },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlugA]: { tenantId: tenantA, displayName: "Mapping Lifecycle A" },
      [workspaceSlugB]: { tenantId: tenantB, displayName: "Mapping Lifecycle B" },
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

    const loginA = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      userId: userA,
      workspaceSlug: workspaceSlugA,
      password: "tej-pim-demo-password",
      expiresInMinutes: 30,
    });
    assertStatus(loginA, 201, "login tenant A");
    const tokenA = String(loginA.payload?.accessToken ?? "");
    assert(tokenA.length > 10, "missing access token for tenant A");

    const loginB = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      userId: userB,
      workspaceSlug: workspaceSlugB,
      password: "tej-pim-demo-password",
      expiresInMinutes: 30,
    });
    assertStatus(loginB, 201, "login tenant B");
    const tokenB = String(loginB.payload?.accessToken ?? "");
    assert(tokenB.length > 10, "missing access token for tenant B");

    const category = await apiRequest(baseUrl, "POST", "/taxonomy/categories", tokenA, {
      name: `Mapping Lifecycle Category ${runId}`,
    });
    assertStatus(category, 201, "create category");
    const categoryId = String(category.payload.id);

    const product = await apiRequest(baseUrl, "POST", "/catalog/products", tokenA, {
      title: `Mapping Lifecycle Product ${runId}`,
      brand: "TEJ PIM",
      description: "mapping lifecycle test",
      categoryId,
      status: "draft",
      attributes: {
        color: "black",
        size: "M",
      },
      hsnCode: "62046200",
      gstRate: 12,
    });
    assertStatus(product, 201, "create product");
    const productId = String(product.payload.id);

    const install = await apiRequest(baseUrl, "POST", "/connectors/flipkart/install", tokenA, {
      accountAlias: `qa-${runId}`,
      externalAccountRef: `merchant-${runId}`,
    });
    assertStatus(install, 201, "install flipkart connector");

    const createDraft = await apiRequest(
      baseUrl,
      "POST",
      "/marketplace/connectors/flipkart/mappings/versions",
      tokenA,
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
            "attributes.color": "color",
            "attributes.size": "size",
          },
        },
        fallbackPolicy: {
          enabled: true,
          warning_tag: "fallback_category_mapping",
        },
        fallbackAckRequired: true,
      },
    );
    assertStatus(createDraft, 201, "create connector mapping draft");
    assert(createDraft.payload.lifecycleState === "draft", "mapping draft lifecycle mismatch");
    const versionId = String(createDraft.payload.id);

    const validateVersion = await apiRequest(
      baseUrl,
      "POST",
      `/marketplace/connectors/flipkart/mappings/versions/${encodeURIComponent(versionId)}/validate`,
      tokenA,
      {},
    );
    assertStatus(validateVersion, 201, "validate connector mapping version");
    assert(validateVersion.payload.lifecycleState === "validated", "mapping validate lifecycle mismatch");

    const publishStepUpToken = await issueStepUp(baseUrl, tokenA);
    const publishVersion = await apiRequest(
      baseUrl,
      "POST",
      `/marketplace/connectors/flipkart/mappings/versions/${encodeURIComponent(versionId)}/publish`,
      tokenA,
      { confirm: true },
      { [STEP_UP_HEADER]: publishStepUpToken },
    );
    assertStatus(publishVersion, 201, "publish connector mapping version");
    assert(
      publishVersion.payload?.published?.lifecycleState === "published",
      "mapping publish lifecycle mismatch",
    );

    const readinessBlocked = await apiRequest(
      baseUrl,
      "POST",
      "/marketplace/products/" + encodeURIComponent(productId) + "/export-jobs",
      tokenA,
      {
        channel: "flipkart",
        maxRetries: 1,
        fallbackAcknowledged: false,
      },
    );
    assertStatus(readinessBlocked, 400, "export blocked without fallback acknowledgement");
    assert(
      Array.isArray(readinessBlocked.payload?.blockers) &&
        readinessBlocked.payload.blockers.includes("fallback_ack_required"),
      "expected fallback acknowledgement blocker",
    );

    const readinessAccepted = await apiRequest(
      baseUrl,
      "POST",
      "/marketplace/products/" + encodeURIComponent(productId) + "/export-jobs",
      tokenA,
      {
        channel: "flipkart",
        maxRetries: 1,
        fallbackAcknowledged: true,
      },
    );
    assertStatus(readinessAccepted, 201, "export accepted with fallback acknowledgement");

    const tenantBVersions = await apiRequest(
      baseUrl,
      "GET",
      "/marketplace/connectors/flipkart/mappings/versions?categoryScope=*&includeArchived=true",
      tokenB,
    );
    assertStatus(tenantBVersions, 200, "tenant B version listing");
    assert(Array.isArray(tenantBVersions.payload), "tenant B mapping list must be an array");
    assert(tenantBVersions.payload.length === 0, "tenant B must not see tenant A mapping versions");

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantA,
          tenantB,
          versionId,
          validated: [
            "mapping_lifecycle_draft_validate_publish",
            "publish_readiness_fallback_ack_gate",
            "tenant_isolation_for_mapping_versions",
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
  console.error("[connector-mapping-lifecycle.test] FAILED");
  console.error(error);
  process.exitCode = 1;
});
