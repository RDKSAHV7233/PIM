#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const os = require("node:os");
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
    const raw = line.slice(idx + 1).trim();
    const value = raw.replace(/^"|"$/g, "");
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
  setDefaultEnv("PIM_AUTH_REDIS_DISABLED", "true");
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "vexa-pim-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/vexa-pim-local");
  setDefaultEnv("APP_ENV", "development");
  setDefaultEnv("FEATURE_REAL_SPAPI_VALIDATION", "false");
  setDefaultEnv("PIM_AUTH_PASSWORD", "vexa-pim-demo-password");
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
      // Retry until timeout.
    }
    await sleep(400);
  }
  throw new Error(`API did not become healthy at ${baseUrl}/health within ${timeoutMs}ms`);
}

async function apiRequest(baseUrl, method, route, body, extraHeaders = {}) {
  const headers = { Accept: "application/json", ...extraHeaders };
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
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return { status: response.status, payload, headers: response.headers };
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

function startApi(env) {
  const stdoutBuffer = [];
  const stderrBuffer = [];
  const processHandle = spawn("node", [API_ENTRY], {
    cwd: REPO_ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  processHandle.stdout.on("data", (chunk) => {
    stdoutBuffer.push(String(chunk));
    if (stdoutBuffer.length > 200) stdoutBuffer.shift();
  });
  processHandle.stderr.on("data", (chunk) => {
    stderrBuffer.push(String(chunk));
    if (stderrBuffer.length > 200) stderrBuffer.shift();
  });
  return { processHandle, stdoutBuffer, stderrBuffer };
}

function stopApi(handle) {
  if (!handle || handle.killed || !handle.pid) {
    return;
  }
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/pid", String(handle.pid), "/t", "/f"], { stdio: "ignore" });
    } catch {
      // ignore cleanup failures
    }
    return;
  }
  handle.kill("SIGTERM");
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const port = 5300 + Math.floor(Math.random() * 90);
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;
  const outboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "pim1-api-error-envelope-"));

  const env = {
    ...process.env,
    PORT: String(port),
    AUTH_MODE: "db",
    FEATURE_PUBLIC_SIGNUP_ENABLED: "true",
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_AUTH_IDENTITIES_JSON: "",
    PIM_AUTH_WORKSPACES_JSON: "",
    AUTH_EMAIL_PROVIDER: "file",
    AUTH_EMAIL_OUTBOX_DIR: outboxDir,
    PIM_WEB_BASE_URL: "http://localhost:3000",
  };

  const api = startApi(env);

  try {
    await waitForHealth(baseUrl, 60_000);

    // 1. Business-rule rejection keeps the bare `{ error: "CODE" }` envelope.
    const businessRule = await apiRequest(
      baseUrl,
      "GET",
      "/signup/workspace/availability?workspaceSlug=bad_slug",
    );
    assertStatus(businessRule, 400, "business-rule rejection status unchanged");
    assert(
      businessRule.payload && typeof businessRule.payload === "object",
      `expected JSON body for business-rule rejection, got ${JSON.stringify(businessRule.payload)}`,
    );
    assert(
      businessRule.payload.error === "WORKSPACE_SLUG_INVALID",
      `expected top-level error CODE WORKSPACE_SLUG_INVALID, got ${JSON.stringify(businessRule.payload)}`,
    );
    assert(
      JSON.stringify(Object.keys(businessRule.payload).sort()) === JSON.stringify(["error"]),
      `business-rule envelope must be exactly { error }, got ${JSON.stringify(businessRule.payload)}`,
    );

    // 2. DTO validation failure is normalized onto the same `{ error: CODE, ... }` envelope.
    const validation = await apiRequest(baseUrl, "POST", "/signup/workspace", {
      displayName: "",
      workspaceSlug: "ok-slug",
      adminEmail: "not-an-email",
      password: "",
      acceptedTerms: "yes",
    });
    assertStatus(validation, 400, "DTO validation failure status");
    assert(
      validation.payload && typeof validation.payload === "object",
      `expected JSON body for validation failure, got ${JSON.stringify(validation.payload)}`,
    );
    assert(
      validation.payload.error === "VALIDATION_FAILED",
      `expected top-level error CODE VALIDATION_FAILED, got ${JSON.stringify(validation.payload)}`,
    );
    assert(
      typeof validation.payload.message === "string" && validation.payload.message.length > 0,
      `expected string message summarizing the first constraint, got ${JSON.stringify(validation.payload)}`,
    );
    assert(
      Array.isArray(validation.payload.fields) && validation.payload.fields.length > 0,
      `expected non-empty fields array, got ${JSON.stringify(validation.payload)}`,
    );
    for (const entry of validation.payload.fields) {
      assert(
        entry && typeof entry.field === "string" && Array.isArray(entry.constraints),
        `each fields entry must be { field: string, constraints: string[] }, got ${JSON.stringify(entry)}`,
      );
    }
    const emailField = validation.payload.fields.find((entry) => entry.field === "adminEmail");
    assert(
      emailField && emailField.constraints.some((c) => /email/i.test(c)),
      `expected an adminEmail field entry with an email constraint, got ${JSON.stringify(validation.payload.fields)}`,
    );
    // Regression guard: the old Nest default shape must not leak through.
    assert(
      !("statusCode" in validation.payload) && validation.payload.error !== "Bad Request",
      `validation envelope must not carry the legacy { message, error: "Bad Request", statusCode } shape, got ${JSON.stringify(validation.payload)}`,
    );

    // 3. The normalization also covers the password-recovery DTO.
    const resetValidation = await apiRequest(baseUrl, "POST", "/auth/password-reset/confirm", {});
    assertStatus(resetValidation, 400, "password reset confirm validation failure status");
    assert(
      resetValidation.payload && resetValidation.payload.error === "VALIDATION_FAILED",
      `expected VALIDATION_FAILED for password reset confirm, got ${JSON.stringify(resetValidation.payload)}`,
    );
    const resetFields = new Set((resetValidation.payload.fields ?? []).map((entry) => entry.field));
    assert(
      resetFields.has("token") && resetFields.has("password"),
      `expected token and password field entries, got ${JSON.stringify(resetValidation.payload.fields)}`,
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          validated: [
            "business_rule_rejection_returns_bare_error_code_envelope",
            "dto_validation_failure_returns_validation_failed_envelope_with_fields",
            "validation_envelope_drops_legacy_bad_request_shape",
            "password_reset_confirm_dto_validation_is_normalized",
          ],
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    console.error("API error envelope integration test failed:");
    console.error(details);
    const stdout = api.stdoutBuffer.join("").slice(-4000);
    const stderr = api.stderrBuffer.join("").slice(-4000);
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
    stopApi(api.processHandle);
    fs.rmSync(outboxDir, { recursive: true, force: true });
  }
}

run().catch((error) => {
  console.error("API error envelope integration test crashed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
