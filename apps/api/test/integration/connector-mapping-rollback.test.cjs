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

async function createDraft(baseUrl, token, connectorSlug, payload) {
  return apiRequest(baseUrl, "POST", `/marketplace/connectors/${connectorSlug}/mappings/versions`, token, payload);
}

async function validateVersion(baseUrl, token, connectorSlug, versionId) {
  return apiRequest(
    baseUrl,
    "POST",
    `/marketplace/connectors/${connectorSlug}/mappings/versions/${encodeURIComponent(versionId)}/validate`,
    token,
    {},
  );
}

async function publishVersion(baseUrl, token, connectorSlug, versionId) {
  const stepUpToken = await issueStepUp(baseUrl, token);
  return apiRequest(
    baseUrl,
    "POST",
    `/marketplace/connectors/${connectorSlug}/mappings/versions/${encodeURIComponent(versionId)}/publish`,
    token,
    { confirm: true },
    { [STEP_UP_HEADER]: stepUpToken },
  );
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const apiPort = 6920 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantA = `mapping-rollback-a-${runId}`;
  const tenantB = `mapping-rollback-b-${runId}`;
  const userA = `mapping-rollback-user-a-${runId}`;
  const userB = `mapping-rollback-user-b-${runId}`;

  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantA,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [userA]: { tenantId: tenantA, role: "admin" },
      [userB]: { tenantId: tenantB, role: "admin" },
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
      password: "tej-pim-demo-password",
      expiresInMinutes: 30,
    });
    assertStatus(loginA, 201, "login tenant A");
    const tokenA = String(loginA.payload?.accessToken ?? "");
    assert(tokenA.length > 10, "missing access token for tenant A");

    const loginB = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      userId: userB,
      password: "tej-pim-demo-password",
      expiresInMinutes: 30,
    });
    assertStatus(loginB, 201, "login tenant B");
    const tokenB = String(loginB.payload?.accessToken ?? "");
    assert(tokenB.length > 10, "missing access token for tenant B");

    const category = await apiRequest(baseUrl, "POST", "/taxonomy/categories", tokenA, {
      name: `Mapping Rollback Category ${runId}`,
    });
    assertStatus(category, 201, "create category");
    const categoryId = String(category.payload.id);

    const install = await apiRequest(baseUrl, "POST", "/connectors/flipkart/install", tokenA, {
      accountAlias: `rollback-${runId}`,
    });
    assertStatus(install, 201, "install flipkart connector");

    const v1Draft = await createDraft(baseUrl, tokenA, "flipkart", {
      categoryScope: categoryId,
      mappingLevel: "tenant_connector_category_mapping",
      connectorDefinitionId: "flipkart",
      connectorDefinitionVersion: "1.0.0",
      compatibilityState: "deprecated",
      mappingRules: {
        field_mappings: {
          title: "legacy_title",
          brand: "brand",
          description: "description",
          hsnCode: "hsn_code",
          gstRate: "gst_rate",
        },
        category: {
          source: categoryId,
          target: categoryId,
        },
      },
      fallbackPolicy: {},
      fallbackAckRequired: false,
    });
    assertStatus(v1Draft, 201, "create v1 draft");
    const v1Id = String(v1Draft.payload.id);

    const v1Validated = await validateVersion(baseUrl, tokenA, "flipkart", v1Id);
    assertStatus(v1Validated, 201, "validate v1");

    const v1Published = await publishVersion(baseUrl, tokenA, "flipkart", v1Id);
    assertStatus(v1Published, 201, "publish v1");

    const v2Draft = await createDraft(baseUrl, tokenA, "flipkart", {
      categoryScope: categoryId,
      mappingLevel: "tenant_connector_category_mapping",
      connectorDefinitionId: "flipkart",
      connectorDefinitionVersion: "1.0.1",
      compatibilityState: "compatible",
      mappingRules: {
        field_mappings: {
          title: "current_title",
          brand: "brand_name",
          description: "description",
          hsnCode: "hsn_code",
          gstRate: "gst_rate",
        },
        category: {
          source: categoryId,
          target: categoryId,
        },
      },
      fallbackPolicy: {},
      fallbackAckRequired: false,
    });
    assertStatus(v2Draft, 201, "create v2 draft");
    const v2Id = String(v2Draft.payload.id);

    const v2Validated = await validateVersion(baseUrl, tokenA, "flipkart", v2Id);
    assertStatus(v2Validated, 201, "validate v2");

    const v2Published = await publishVersion(baseUrl, tokenA, "flipkart", v2Id);
    assertStatus(v2Published, 201, "publish v2");

    const resolvedCurrent = await apiRequest(
      baseUrl,
      "GET",
      `/marketplace/connectors/flipkart/mappings/resolve?categoryScope=${encodeURIComponent(categoryId)}`,
      tokenA,
    );
    assertStatus(resolvedCurrent, 200, "resolve current mapping");
    assert(
      resolvedCurrent.payload?.resolvedMapping?.field_mappings?.title === "current_title",
      `expected v2 mapping to be active, payload=${JSON.stringify(resolvedCurrent.payload)}`,
    );

    const noConfirmStepUp = await issueStepUp(baseUrl, tokenA);
    const noConfirm = await apiRequest(
      baseUrl,
      "POST",
      `/marketplace/connectors/flipkart/mappings/versions/${encodeURIComponent(v1Id)}/rollback`,
      tokenA,
      { confirm: false, reason: "should fail" },
      { [STEP_UP_HEADER]: noConfirmStepUp },
    );
    assertStatus(noConfirm, 400, "rollback confirmation required");

    const tenantBStepUp = await issueStepUp(baseUrl, tokenB);
    const tenantBDenied = await apiRequest(
      baseUrl,
      "POST",
      `/marketplace/connectors/flipkart/mappings/versions/${encodeURIComponent(v1Id)}/rollback`,
      tokenB,
      { confirm: true, reason: "cross-tenant denied" },
      { [STEP_UP_HEADER]: tenantBStepUp },
    );
    assertStatus(tenantBDenied, 404, "tenant B rollback denial");

    const rollbackStepUp = await issueStepUp(baseUrl, tokenA);
    const rollback = await apiRequest(
      baseUrl,
      "POST",
      `/marketplace/connectors/flipkart/mappings/versions/${encodeURIComponent(v1Id)}/rollback`,
      tokenA,
      { confirm: true, reason: "restore prior known-good mapping" },
      { [STEP_UP_HEADER]: rollbackStepUp },
    );
    assertStatus(rollback, 201, "rollback v1");
    assert(
      rollback.payload?.rollbackSourceVersionId === v1Id,
      `expected rollback source id ${v1Id}, payload=${JSON.stringify(rollback.payload)}`,
    );
    const rollbackPublishedId = String(rollback.payload?.published?.id ?? "");
    assert(rollbackPublishedId && rollbackPublishedId !== v1Id, "rollback must create a new published version");
    assert(
      Array.isArray(rollback.payload?.superseded) && rollback.payload.superseded.includes(v2Id),
      `expected rollback to supersede v2, payload=${JSON.stringify(rollback.payload)}`,
    );

    const versions = await apiRequest(
      baseUrl,
      "GET",
      `/marketplace/connectors/flipkart/mappings/versions?categoryScope=${encodeURIComponent(categoryId)}&includeArchived=true`,
      tokenA,
    );
    assertStatus(versions, 200, "list versions after rollback");
    const publishedVersions = versions.payload.filter((item) => item.lifecycleState === "published");
    assert(publishedVersions.length === 1, `expected one published version, payload=${JSON.stringify(versions.payload)}`);
    assert(
      publishedVersions[0].id === rollbackPublishedId,
      `expected rollback version to be sole published version, payload=${JSON.stringify(versions.payload)}`,
    );
    const supersededV2 = versions.payload.find((item) => item.id === v2Id);
    assert(
      supersededV2?.lifecycleState === "superseded" && supersededV2?.supersededBy === rollbackPublishedId,
      `expected v2 to be superseded by rollback version, payload=${JSON.stringify(versions.payload)}`,
    );

    const resolvedRolledBack = await apiRequest(
      baseUrl,
      "GET",
      `/marketplace/connectors/flipkart/mappings/resolve?categoryScope=${encodeURIComponent(categoryId)}`,
      tokenA,
    );
    assertStatus(resolvedRolledBack, 200, "resolve rolled back mapping");
    assert(
      resolvedRolledBack.payload?.resolvedMapping?.field_mappings?.title === "legacy_title",
      `expected rollback to restore v1 mapping rules, payload=${JSON.stringify(resolvedRolledBack.payload)}`,
    );
    assert(
      resolvedRolledBack.payload?.compatibilityState === "deprecated",
      `expected rollback to preserve source compatibility state, payload=${JSON.stringify(resolvedRolledBack.payload)}`,
    );

    const preflight = await apiRequest(
      baseUrl,
      "POST",
      "/marketplace/connectors/flipkart/mappings/preflight",
      tokenA,
      {
        categoryScope: categoryId,
        fallbackAcknowledged: false,
      },
    );
    assertStatus(preflight, 201, "preflight after rollback");
    assert(
      Array.isArray(preflight.payload?.warnings) && preflight.payload.warnings.includes("mapping_deprecated"),
      `expected rollback compatibility warning, payload=${JSON.stringify(preflight.payload)}`,
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantA,
          tenantB,
          rollbackSourceVersionId: v1Id,
          rollbackPublishedVersionId: rollbackPublishedId,
          validated: [
            "rollback_requires_confirmation",
            "rollback_restores_prior_mapping_as_new_published_version",
            "rollback_preserves_one_published_version_invariant",
            "rollback_preserves_source_compatibility_behavior",
            "rollback_is_tenant_isolated",
          ],
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error("[connector-mapping-rollback.test] FAILED");
    console.error(error);
    if (stdoutBuffer.length) {
      console.error("--- API stdout tail ---");
      console.error(stdoutBuffer.join("").slice(-4000));
    }
    if (stderrBuffer.length) {
      console.error("--- API stderr tail ---");
      console.error(stderrBuffer.join("").slice(-4000));
    }
    process.exitCode = 1;
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
  console.error("[connector-mapping-rollback.test] FAILED");
  console.error(error);
  process.exitCode = 1;
});
