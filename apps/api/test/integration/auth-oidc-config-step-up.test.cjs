#!/usr/bin/env node
/* eslint-disable no-console */
// Integration test for OIDC IdP-configuration step-up auth.
//
// Asserts at runtime, against a real booted API:
//   1. POST /auth/oidc-config without a step-up token -> 401 STEP_UP_REQUIRED.
//   2. POST /auth/step-up with scope auth_config_high_risk -> 201 with stepUpToken.
//   3. POST /auth/oidc-config with the correct step-up token -> 201 (config saved).
//   4. POST /auth/oidc-config with a step-up token for the wrong scope
//      (mapping_high_risk) -> 403 STEP_UP_SCOPE_MISMATCH.
//   5. DELETE /auth/oidc-config without a step-up token -> 401 STEP_UP_REQUIRED.
//   6. DELETE /auth/oidc-config with the correct step-up token -> 204.
//   7. GET /auth/oidc-config does NOT require step-up (reads are admin-only but
//      not auth-config-mutating).
//
// This complements the static contract test at
// apps/web/test/integration/admin-oidc-config-route-contract.test.cjs which
// asserts source structure; this test asserts runtime behavior of the StepUpGuard
// + @RequireStepUp(auth_config_high_risk) wiring shipped 2026-05-17.

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");

const STEP_UP_TOKEN_HEADER = "x-pim-step-up-token";
const SCOPE_AUTH_CONFIG = "auth_config_high_risk";
const SCOPE_MAPPING = "mapping_high_risk";

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
  setDefaultEnv("PIM_AUTH_PASSWORD", "vexa-pim-demo-password");
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

async function apiRequest(baseUrl, method, route, token, body, extraHeaders) {
  const headers = { Accept: "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  if (extraHeaders) {
    for (const [key, value] of Object.entries(extraHeaders)) {
      headers[key] = value;
    }
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
  return { status: response.status, payload };
}

function assertStatus(result, expected, context) {
  if (result.status !== expected) {
    throw new Error(
      `${context} failed: expected ${expected}, got ${result.status} payload=${JSON.stringify(result.payload)}`,
    );
  }
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
  const apiPort = 6100 + Math.floor(Math.random() * 120);
  const baseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const tenantId = `oidc-stepup-${runId}`;
  const workspaceSlug = `oidc-${runId}`.slice(0, 24);
  const userId = `oidc-admin-${runId}`;
  const env = {
    ...process.env,
    PORT: String(apiPort),
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [userId]: { tenantId, role: "admin", workspaceSlug },
    }),
    PIM_AUTH_WORKSPACES_JSON: JSON.stringify({
      [workspaceSlug]: { tenantId, displayName: "OIDC Step-Up Workspace" },
    }),
  };

  const apiProcess = spawn("node", [API_ENTRY], {
    cwd: REPO_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stdoutBuffer = [];
  const stderrBuffer = [];
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

    // Admin login.
    const login = await apiRequest(baseUrl, "POST", "/auth/login", null, {
      workspaceSlug,
      userId,
      password: process.env.PIM_AUTH_PASSWORD || "vexa-pim-demo-password",
      expiresInMinutes: 30,
    });
    assertStatus(login, 201, "admin login");
    const accessToken = String(login.payload?.accessToken ?? "");
    assert(accessToken.length > 10, "missing access token from login");

    const validConfig = {
      issuer: "https://idp.example.com/oidc",
      clientId: `client-${runId}`,
      clientSecret: `secret-${runId}`,
      callbackUrl: "https://vexa.example.com/auth/oidc/callback",
      scopes: ["openid", "email", "profile"],
      claimsMapping: { roles: { pim_admin: "admin" } },
    };

    // 1. POST /auth/oidc-config WITHOUT step-up token -> 401 STEP_UP_REQUIRED.
    const denied = await apiRequest(baseUrl, "POST", "/auth/oidc-config", accessToken, validConfig);
    assertStatus(denied, 401, "POST oidc-config without step-up token");
    const deniedError = denied.payload && (denied.payload.error || denied.payload.message);
    assert(
      String(deniedError ?? "").includes("STEP_UP_REQUIRED"),
      `expected STEP_UP_REQUIRED on denied payload, got ${JSON.stringify(denied.payload)}`,
    );

    // 2. Issue step-up token with auth_config_high_risk scope.
    const stepUp = await apiRequest(baseUrl, "POST", "/auth/step-up", accessToken, {
      password: process.env.PIM_AUTH_PASSWORD || "vexa-pim-demo-password",
      scope: SCOPE_AUTH_CONFIG,
    });
    assertStatus(stepUp, 201, "issue auth_config step-up token");
    const stepUpToken = String(stepUp.payload?.stepUpToken ?? "");
    assert(stepUpToken.length > 10, "missing stepUpToken from /auth/step-up response");

    // 3. POST /auth/oidc-config WITH the correct step-up token -> 201.
    const upsertOk = await apiRequest(
      baseUrl,
      "POST",
      "/auth/oidc-config",
      accessToken,
      validConfig,
      { [STEP_UP_TOKEN_HEADER]: stepUpToken },
    );
    assertStatus(upsertOk, 201, "POST oidc-config with valid step-up token");
    assert(upsertOk.payload?.issuer === validConfig.issuer, "saved config must reflect issuer");
    assert(upsertOk.payload?.clientId === validConfig.clientId, "saved config must reflect clientId");
    assert(
      Array.isArray(upsertOk.payload?.scopes) && upsertOk.payload.scopes.includes("openid"),
      "saved config must reflect scopes",
    );
    assert(upsertOk.payload?.status === "active", "saved config status must be active");

    // 4. POST with WRONG scope step-up token -> 403 STEP_UP_SCOPE_MISMATCH.
    const wrongScope = await apiRequest(baseUrl, "POST", "/auth/step-up", accessToken, {
      password: process.env.PIM_AUTH_PASSWORD || "vexa-pim-demo-password",
      scope: SCOPE_MAPPING,
    });
    assertStatus(wrongScope, 201, "issue mapping_high_risk step-up token");
    const mappingToken = String(wrongScope.payload?.stepUpToken ?? "");
    assert(mappingToken.length > 10, "missing mapping_high_risk stepUpToken");

    const scopeMismatch = await apiRequest(
      baseUrl,
      "POST",
      "/auth/oidc-config",
      accessToken,
      validConfig,
      { [STEP_UP_TOKEN_HEADER]: mappingToken },
    );
    assertStatus(scopeMismatch, 403, "POST oidc-config with wrong-scope step-up token");
    const mismatchError = scopeMismatch.payload && (scopeMismatch.payload.error || scopeMismatch.payload.message);
    assert(
      String(mismatchError ?? "").includes("STEP_UP_SCOPE_MISMATCH"),
      `expected STEP_UP_SCOPE_MISMATCH on scope mismatch, got ${JSON.stringify(scopeMismatch.payload)}`,
    );

    // 5. GET /auth/oidc-config does NOT require step-up (read endpoint).
    const getOk = await apiRequest(baseUrl, "GET", "/auth/oidc-config", accessToken);
    assertStatus(getOk, 200, "GET oidc-config without step-up token");
    assert(getOk.payload?.issuer === validConfig.issuer, "GET must return saved issuer");

    // 6. DELETE WITHOUT step-up token -> 401 STEP_UP_REQUIRED.
    const deleteDenied = await apiRequest(baseUrl, "DELETE", "/auth/oidc-config", accessToken);
    assertStatus(deleteDenied, 401, "DELETE oidc-config without step-up token");

    // 7. Issue a fresh auth_config_high_risk step-up token, then DELETE with it -> 204.
    const stepUp2 = await apiRequest(baseUrl, "POST", "/auth/step-up", accessToken, {
      password: process.env.PIM_AUTH_PASSWORD || "vexa-pim-demo-password",
      scope: SCOPE_AUTH_CONFIG,
    });
    assertStatus(stepUp2, 201, "issue second auth_config step-up token");
    const stepUpToken2 = String(stepUp2.payload?.stepUpToken ?? "");
    assert(stepUpToken2.length > 10, "missing second stepUpToken");

    const deleteOk = await apiRequest(
      baseUrl,
      "DELETE",
      "/auth/oidc-config",
      accessToken,
      undefined,
      { [STEP_UP_TOKEN_HEADER]: stepUpToken2 },
    );
    assertStatus(deleteOk, 204, "DELETE oidc-config with valid step-up token");

    // 8. After delete, GET should return 404.
    const getAfterDelete = await apiRequest(baseUrl, "GET", "/auth/oidc-config", accessToken);
    assertStatus(getAfterDelete, 404, "GET oidc-config after delete");

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantId,
          validated: [
            "post_without_stepup_returns_401_step_up_required",
            "post_step_up_with_auth_config_scope_mints_token",
            "post_oidc_config_with_valid_stepup_token_returns_201",
            "saved_config_has_correct_shape",
            "post_oidc_config_with_wrong_scope_returns_403_scope_mismatch",
            "get_oidc_config_does_not_require_stepup",
            "delete_without_stepup_returns_401",
            "delete_with_valid_stepup_returns_204",
            "get_after_delete_returns_404",
          ],
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error("OIDC step-up integration test failed:");
    console.error(error instanceof Error ? error.message : String(error));
    console.error("--- API stdout tail ---");
    console.error(stdoutBuffer.join(""));
    console.error("--- API stderr tail ---");
    console.error(stderrBuffer.join(""));
    process.exitCode = 1;
  } finally {
    if (!apiProcess.killed) {
      apiProcess.kill("SIGTERM");
      const killTimeout = setTimeout(() => {
        if (!apiProcess.killed) {
          apiProcess.kill("SIGKILL");
        }
      }, 5_000);
      await new Promise((resolve) => {
        apiProcess.on("exit", () => {
          clearTimeout(killTimeout);
          resolve(null);
        });
      });
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
