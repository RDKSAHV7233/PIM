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
  setDefaultEnv("PIM_AUTH_PASSWORD", "tej-pim-demo-password");
  setDefaultEnv("PIM_STEP_UP_EXPIRY_SECONDS", "1");
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

async function createDraft(baseUrl, token, categoryScope, version) {
  return apiRequest(baseUrl, "POST", "/marketplace/connectors/flipkart/mappings/versions", token, {
    categoryScope,
    mappingLevel: "tenant_connector_category_mapping",
    connectorDefinitionId: "flipkart",
    connectorDefinitionVersion: version,
    compatibilityState: "compatible",
    mappingRules: {
      field_mappings: {
        title: `title_${version.replace(/\./g, "_")}`,
        brand: "brand",
        description: "description",
        hsnCode: "hsn_code",
        gstRate: "gst_rate",
      },
      category: {
        source: categoryScope,
        target: categoryScope,
      },
    },
    fallbackPolicy: {},
    fallbackAckRequired: false,
  });
}

async function validateVersion(baseUrl, token, versionId) {
  return apiRequest(
    baseUrl,
    "POST",
    `/marketplace/connectors/flipkart/mappings/versions/${encodeURIComponent(versionId)}/validate`,
    token,
    {},
  );
}

async function publishVersion(baseUrl, token, versionId, stepUpToken) {
  return apiRequest(
    baseUrl,
    "POST",
    `/marketplace/connectors/flipkart/mappings/versions/${encodeURIComponent(versionId)}/publish`,
    token,
    { confirm: true },
    stepUpToken ? { [STEP_UP_HEADER]: stepUpToken } : {},
  );
}

async function rollbackVersion(baseUrl, token, versionId, stepUpToken, reason = "restore prior mapping") {
  return apiRequest(
    baseUrl,
    "POST",
    `/marketplace/connectors/flipkart/mappings/versions/${encodeURIComponent(versionId)}/rollback`,
    token,
    { confirm: true, reason },
    stepUpToken ? { [STEP_UP_HEADER]: stepUpToken } : {},
  );
}

async function archiveVersion(baseUrl, token, versionId, stepUpToken, reason = "archive stale mapping") {
  return apiRequest(
    baseUrl,
    "POST",
    `/marketplace/connectors/flipkart/mappings/versions/${encodeURIComponent(versionId)}/archive`,
    token,
    { reason },
    stepUpToken ? { [STEP_UP_HEADER]: stepUpToken } : {},
  );
}

async function issueStepUp(baseUrl, token, password) {
  return apiRequest(baseUrl, "POST", "/auth/step-up", token, {
    password,
    scope: STEP_UP_SCOPE,
  });
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const apiPort = 7040 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantA = `mapping-stepup-a-${runId}`;
  const userA = `mapping-stepup-user-a-${runId}`;

  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantA,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [userA]: { tenantId: tenantA, role: "admin" },
    }),
  };

  const stdoutBuffer = [];
  const stderrBuffer = [];
  const apiProcess = spawn(process.execPath, ["-e", `require(${JSON.stringify(API_ENTRY)})`], {
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
    const accessTokenA = String(loginA.payload?.accessToken ?? "");
    assert(accessTokenA.length > 10, "missing access token for tenant A");

    const secondLoginA = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      userId: userA,
      password: "tej-pim-demo-password",
      expiresInMinutes: 30,
    });
    assertStatus(secondLoginA, 201, "second login tenant A");
    const accessTokenA2 = String(secondLoginA.payload?.accessToken ?? "");
    assert(accessTokenA2.length > 10, "missing second access token for tenant A");

    const category = await apiRequest(baseUrl, "POST", "/taxonomy/categories", accessTokenA, {
      name: `Mapping Step Up Category ${runId}`,
    });
    assertStatus(category, 201, "create category");
    const categoryId = String(category.payload.id);

    const install = await apiRequest(baseUrl, "POST", "/connectors/flipkart/install", accessTokenA, {
      accountAlias: `stepup-${runId}`,
    });
    assertStatus(install, 201, "install flipkart connector");

    const draftV1 = await createDraft(baseUrl, accessTokenA, categoryId, "1.0.0");
    assertStatus(draftV1, 201, "create v1 draft");
    const v1Id = String(draftV1.payload.id);
    assertStatus(await validateVersion(baseUrl, accessTokenA, v1Id), 201, "validate v1");

    const publishWithoutStepUp = await publishVersion(baseUrl, accessTokenA, v1Id, null);
    assertStatus(publishWithoutStepUp, 401, "publish requires step-up");
    assert(
      publishWithoutStepUp.payload?.error === "STEP_UP_REQUIRED",
      `expected STEP_UP_REQUIRED, payload=${JSON.stringify(publishWithoutStepUp.payload)}`,
    );

    const deniedStepUp = await issueStepUp(baseUrl, accessTokenA, "wrong-password");
    assertStatus(deniedStepUp, 401, "step-up invalid credentials");
    assert(
      deniedStepUp.payload?.error === "STEP_UP_INVALID_CREDENTIALS",
      `expected STEP_UP_INVALID_CREDENTIALS, payload=${JSON.stringify(deniedStepUp.payload)}`,
    );

    const validStepUp = await issueStepUp(baseUrl, accessTokenA, "tej-pim-demo-password");
    assertStatus(validStepUp, 201, "issue valid step-up token");
    const stepUpToken = String(validStepUp.payload?.stepUpToken ?? "");
    assert(stepUpToken.length > 10, "missing step-up token");

    const sessionMismatch = await publishVersion(baseUrl, accessTokenA2, v1Id, stepUpToken);
    assertStatus(sessionMismatch, 403, "step-up token session mismatch");
    assert(
      sessionMismatch.payload?.error === "STEP_UP_TOKEN_SESSION_MISMATCH",
      `expected STEP_UP_TOKEN_SESSION_MISMATCH, payload=${JSON.stringify(sessionMismatch.payload)}`,
    );

    assertStatus(await publishVersion(baseUrl, accessTokenA, v1Id, stepUpToken), 201, "publish v1 with step-up");

    const draftV2 = await createDraft(baseUrl, accessTokenA, categoryId, "1.0.1");
    assertStatus(draftV2, 201, "create v2 draft");
    const v2Id = String(draftV2.payload.id);
    assertStatus(await validateVersion(baseUrl, accessTokenA, v2Id), 201, "validate v2");

    const publishStepUpV2 = await issueStepUp(baseUrl, accessTokenA, "tej-pim-demo-password");
    assertStatus(publishStepUpV2, 201, "issue v2 publish step-up");
    assertStatus(
      await publishVersion(baseUrl, accessTokenA, v2Id, String(publishStepUpV2.payload?.stepUpToken ?? "")),
      201,
      "publish v2 with step-up",
    );

    const rollbackWithoutStepUp = await rollbackVersion(baseUrl, accessTokenA, v1Id, null);
    assertStatus(rollbackWithoutStepUp, 401, "rollback requires step-up");
    assert(
      rollbackWithoutStepUp.payload?.error === "STEP_UP_REQUIRED",
      `expected STEP_UP_REQUIRED for rollback, payload=${JSON.stringify(rollbackWithoutStepUp.payload)}`,
    );

    const rollbackStepUp = await issueStepUp(baseUrl, accessTokenA, "tej-pim-demo-password");
    assertStatus(rollbackStepUp, 201, "issue rollback step-up");
    const rollback = await rollbackVersion(
      baseUrl,
      accessTokenA,
      v1Id,
      String(rollbackStepUp.payload?.stepUpToken ?? ""),
      "restore prior known-good mapping",
    );
    assertStatus(rollback, 201, "rollback with step-up");
    assert(
      rollback.payload?.rollbackSourceVersionId === v1Id,
      `expected rollbackSourceVersionId=${v1Id}, payload=${JSON.stringify(rollback.payload)}`,
    );

    const expiredStepUp = await issueStepUp(baseUrl, accessTokenA, "tej-pim-demo-password");
    assertStatus(expiredStepUp, 201, "issue expiring archive step-up");
    const expiringToken = String(expiredStepUp.payload?.stepUpToken ?? "");
    await sleep(2100);

    const archiveExpired = await archiveVersion(baseUrl, accessTokenA, v2Id, expiringToken);
    assertStatus(archiveExpired, 401, "expired step-up token rejected");
    assert(
      archiveExpired.payload?.error === "STEP_UP_TOKEN_INVALID",
      `expected STEP_UP_TOKEN_INVALID, payload=${JSON.stringify(archiveExpired.payload)}`,
    );

    const archiveStepUp = await issueStepUp(baseUrl, accessTokenA, "tej-pim-demo-password");
    assertStatus(archiveStepUp, 201, "issue archive step-up");
    assertStatus(
      await archiveVersion(baseUrl, accessTokenA, v2Id, String(archiveStepUp.payload?.stepUpToken ?? "")),
      201,
      "archive superseded mapping with step-up",
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantA,
          validated: [
            "publish_requires_step_up",
            "step_up_reauth_requires_valid_password",
            "step_up_token_bound_to_access_session",
            "rollback_requires_step_up",
            "archive_rejects_expired_step_up_token",
            "high_risk_mapping_actions_succeed_with_valid_step_up",
          ],
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error("[connector-mapping-step-up.test] FAILED");
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
  console.error("[connector-mapping-step-up.test] FAILED");
  console.error(error);
  process.exitCode = 1;
});
