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
  setDefaultEnv("PIM_AUTH_REDIS_DISABLED", "true");  // Set L: auth middleware Redis gate
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

async function createDraftVersion(baseUrl, token, connectorSlug, payload) {
  const result = await apiRequest(
    baseUrl,
    "POST",
    `/marketplace/connectors/${encodeURIComponent(connectorSlug)}/mappings/versions`,
    token,
    payload,
  );
  assertStatus(result, 201, `create mapping draft ${payload.mappingLevel}`);
  return result.payload;
}

async function validateVersion(baseUrl, token, connectorSlug, versionId) {
  const result = await apiRequest(
    baseUrl,
    "POST",
    `/marketplace/connectors/${encodeURIComponent(connectorSlug)}/mappings/versions/${encodeURIComponent(versionId)}/validate`,
    token,
    {},
  );
  assertStatus(result, 201, "validate mapping version");
  return result.payload;
}

async function publishVersion(baseUrl, token, connectorSlug, versionId) {
  const stepUpToken = await issueStepUp(baseUrl, token);
  const result = await apiRequest(
    baseUrl,
    "POST",
    `/marketplace/connectors/${encodeURIComponent(connectorSlug)}/mappings/versions/${encodeURIComponent(versionId)}/publish`,
    token,
    { confirm: true },
    { [STEP_UP_HEADER]: stepUpToken },
  );
  assertStatus(result, 201, "publish mapping version");
  return result.payload;
}

async function archiveVersion(baseUrl, token, connectorSlug, versionId, reason) {
  const stepUpToken = await issueStepUp(baseUrl, token);
  const result = await apiRequest(
    baseUrl,
    "POST",
    `/marketplace/connectors/${encodeURIComponent(connectorSlug)}/mappings/versions/${encodeURIComponent(versionId)}/archive`,
    token,
    { reason },
    { [STEP_UP_HEADER]: stepUpToken },
  );
  assertStatus(result, 201, "archive mapping version");
  return result.payload;
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const apiPort = 6900 + Math.floor(Math.random() * 200);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantKey = `mapping-precedence-${runId}`;
  const workspaceSlug = `mapprec-${runId}`.slice(0, 24);
  const userId = `mapping-precedence-user-${runId}`;
  const connectorSlug = "flipkart";

  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantKey,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [userId]: { tenantId: tenantKey, role: "admin", workspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId: tenantKey, displayName: "Mapping Precedence" },
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
      password: getAuthPassword(),
      expiresInMinutes: 30,
    });
    assertStatus(login, 201, "login admin");
    const token = String(login.payload?.accessToken ?? "");
    assert(token.length > 10, "missing access token");

    const category = await apiRequest(baseUrl, "POST", "/taxonomy/categories", token, {
      name: `Mapping Precedence Category ${runId}`,
    });
    assertStatus(category, 201, "create category");
    const categoryId = String(category.payload.id);

    const install = await apiRequest(baseUrl, "POST", `/connectors/${connectorSlug}/install`, token, {
      accountAlias: `precedence-${runId}`,
      externalAccountRef: `merchant-${runId}`,
    });
    assertStatus(install, 201, "install connector");

    const tenantDefaultDraft = await createDraftVersion(baseUrl, token, connectorSlug, {
      categoryScope: "*",
      mappingLevel: "tenant_connector_default",
      connectorDefinitionId: connectorSlug,
      connectorDefinitionVersion: "1.0.0",
      compatibilityState: "compatible",
      mappingRules: {
        field_mappings: {
          title: "default_title",
          brand: "default_brand",
          description: "default_description",
        },
      },
      fallbackPolicy: {
        enabled: true,
        warning_tag: "fallback_category_mapping",
      },
      fallbackAckRequired: false,
    });
    await validateVersion(baseUrl, token, connectorSlug, String(tenantDefaultDraft.id));
    const tenantDefaultPublished = await publishVersion(baseUrl, token, connectorSlug, String(tenantDefaultDraft.id));
    assert(
      tenantDefaultPublished.published?.lifecycleState === "published",
      "tenant default publish lifecycle mismatch",
    );

    const blockedCategoryDraft = await createDraftVersion(baseUrl, token, connectorSlug, {
      categoryScope: categoryId,
      mappingLevel: "tenant_connector_category_mapping",
      connectorDefinitionId: connectorSlug,
      connectorDefinitionVersion: "1.0.0",
      compatibilityState: "blocked",
      mappingRules: {
        field_mappings: {
          title: "category_title_blocked",
          brand: "category_brand_blocked",
        },
        category: {
          source: categoryId,
          target: categoryId,
        },
      },
      fallbackPolicy: {},
      fallbackAckRequired: false,
    });
    await validateVersion(baseUrl, token, connectorSlug, String(blockedCategoryDraft.id));
    const blockedCategoryPublished = await publishVersion(baseUrl, token, connectorSlug, String(blockedCategoryDraft.id));
    const blockedCategoryId = String(blockedCategoryPublished.published?.id ?? blockedCategoryDraft.id);

    const blockedResolve = await apiRequest(
      baseUrl,
      "GET",
      `/marketplace/connectors/${connectorSlug}/mappings/resolve?categoryScope=${encodeURIComponent(categoryId)}`,
      token,
    );
    assertStatus(blockedResolve, 200, "resolve blocked category mapping");
    assert(blockedResolve.payload.compatibilityState === "blocked", "blocked compatibility should dominate");
    assert(Array.isArray(blockedResolve.payload.matchedVersions), "resolve matched versions missing");
    assert(blockedResolve.payload.matchedVersions.length === 2, "expected tenant default + category mapping");
    assert(
      blockedResolve.payload.resolvedMapping?.field_mappings?.title === "category_title_blocked",
      "category-specific mapping must override tenant default",
    );

    const blockedPreflight = await apiRequest(
      baseUrl,
      "POST",
      `/marketplace/connectors/${connectorSlug}/mappings/preflight`,
      token,
      { categoryScope: categoryId, fallbackAcknowledged: false },
    );
    assertStatus(blockedPreflight, 201, "preflight blocked category mapping");
    assert(
      Array.isArray(blockedPreflight.payload.blockers) &&
        blockedPreflight.payload.blockers.includes("mapping_compatibility_blocked"),
      "blocked compatibility must stop preflight",
    );

    const compatibleCategoryDraft = await createDraftVersion(baseUrl, token, connectorSlug, {
      categoryScope: categoryId,
      mappingLevel: "tenant_connector_category_mapping",
      connectorDefinitionId: connectorSlug,
      connectorDefinitionVersion: "1.0.1",
      compatibilityState: "compatible",
      mappingRules: {
        field_mappings: {
          title: "category_title_v2",
          brand: "category_brand_v2",
          description: "category_description_v2",
        },
        category: {
          source: categoryId,
          target: categoryId,
        },
      },
      fallbackPolicy: {},
      fallbackAckRequired: false,
    });
    await validateVersion(baseUrl, token, connectorSlug, String(compatibleCategoryDraft.id));
    const compatibleCategoryPublished = await publishVersion(
      baseUrl,
      token,
      connectorSlug,
      String(compatibleCategoryDraft.id),
    );
    const compatibleCategoryId = String(compatibleCategoryPublished.published?.id ?? compatibleCategoryDraft.id);
    assert(
      Array.isArray(compatibleCategoryPublished.superseded) &&
        compatibleCategoryPublished.superseded.includes(blockedCategoryId),
      "publishing replacement category mapping must supersede prior published category mapping",
    );

    const compatibleResolve = await apiRequest(
      baseUrl,
      "GET",
      `/marketplace/connectors/${connectorSlug}/mappings/resolve?categoryScope=${encodeURIComponent(categoryId)}`,
      token,
    );
    assertStatus(compatibleResolve, 200, "resolve compatible category mapping");
    assert(compatibleResolve.payload.compatibilityState === "compatible", "compatible mapping should clear blocker");
    const compatibleMatchedIds = compatibleResolve.payload.matchedVersions.map((item) => String(item.id));
    assert(!compatibleMatchedIds.includes(blockedCategoryId), "superseded mapping must not remain active");
    assert(
      compatibleResolve.payload.resolvedMapping?.field_mappings?.title === "category_title_v2",
      "latest category mapping must win precedence",
    );

    const archiveResult = await archiveVersion(
      baseUrl,
      token,
      connectorSlug,
      compatibleCategoryId,
      "transition to tenant default fallback",
    );
    assert(archiveResult.lifecycleState === "archived", "archive lifecycle mismatch");

    const fallbackResolve = await apiRequest(
      baseUrl,
      "GET",
      `/marketplace/connectors/${connectorSlug}/mappings/resolve?categoryScope=${encodeURIComponent(categoryId)}`,
      token,
    );
    assertStatus(fallbackResolve, 200, "resolve fallback category mapping");
    assert(fallbackResolve.payload.fallbackApplied === true, "fallback should apply after archive");
    assert(
      fallbackResolve.payload.resolvedMapping?.field_mappings?.title === "default_title",
      "tenant default must backfill archived category mapping",
    );

    const fallbackPreflight = await apiRequest(
      baseUrl,
      "POST",
      `/marketplace/connectors/${connectorSlug}/mappings/preflight`,
      token,
      { categoryScope: categoryId, fallbackAcknowledged: false },
    );
    assertStatus(fallbackPreflight, 201, "preflight fallback category mapping");
    assert(
      Array.isArray(fallbackPreflight.payload.warnings) &&
        fallbackPreflight.payload.warnings.includes("fallback_mapping_applied"),
      "fallback warning must be surfaced after archive",
    );
    assert(
      Array.isArray(fallbackPreflight.payload.blockers) && fallbackPreflight.payload.blockers.length === 0,
      "fallback without ack requirement should not block",
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantKey,
          categoryId,
          validated: [
            "category_mapping_precedence_overrides_tenant_default",
            "compatibility_severity_blocks_preflight",
            "superseded_versions_stop_participating_in_resolution",
            "archived_category_mapping_falls_back_to_tenant_default",
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
  console.error("[connector-mapping-precedence.test] FAILED");
  console.error(error);
  process.exitCode = 1;
});
