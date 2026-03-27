#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");

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

  setDefaultEnv("JWT_SECRET", "tej-pim-local-dev-jwt-secret-minimum-length-32");
  setDefaultEnv("JWT_EXPIRY", "4h");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_V1", "tej-pim-local-encryption-key-v1-minimum-32");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION", "1");
  setDefaultEnv("REDIS_URL", "redis://localhost:6379");
  setDefaultEnv("JWT_BLOCKLIST_REDIS_DISABLED", "true");
  setDefaultEnv("PIM_AUTH_REDIS_DISABLED", "true");
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "tej-pim-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/tej-pim-local");
  setDefaultEnv("APP_ENV", "development");
  setDefaultEnv("FEATURE_REAL_SPAPI_VALIDATION", "false");
  setDefaultEnv("PIM_AUTH_PASSWORD", "tej-pim-demo-password");
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

function compareOutboxEntries(left, right) {
  const leftTime = new Date(left.parsed?.writtenAt ?? 0).getTime();
  const rightTime = new Date(right.parsed?.writtenAt ?? 0).getTime();
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return left.file.localeCompare(right.file);
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
    await sleep(300);
  }
  throw new Error(`API did not become healthy at ${baseUrl}/health within ${timeoutMs}ms`);
}

async function apiRequest(baseUrl, method, route, body, options = {}) {
  const headers = { Accept: "application/json", ...(options.headers ?? {}) };
  if (options.token) {
    headers.Authorization = `Bearer ${options.token}`;
  }
  const requestOptions = {
    method,
    headers,
    signal: AbortSignal.timeout(20_000),
  };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    requestOptions.body = JSON.stringify(body);
  }
  const response = await fetch(`${baseUrl}${route}`, requestOptions);
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return { status: response.status, payload, headers: response.headers };
}

async function login(baseUrl, workspaceSlug, userId, password) {
  return apiRequest(baseUrl, "POST", "/auth/login", {
    workspaceSlug,
    userId,
    password,
    expiresInMinutes: 30,
  });
}

async function waitForOutboxEmail(outboxDir, recipient, category, timeoutMs, previousFileName = null) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const files = fs.existsSync(outboxDir) ? fs.readdirSync(outboxDir) : [];
    const matches = [];
    for (const file of files) {
      const fullPath = path.join(outboxDir, file);
      const parsed = JSON.parse(fs.readFileSync(fullPath, "utf8"));
      if (
        String(parsed.to ?? "").trim().toLowerCase() === recipient.toLowerCase() &&
        String(parsed.category ?? "").trim() === category &&
        (!previousFileName || file !== previousFileName)
      ) {
        matches.push({ file, parsed });
      }
    }
    if (matches.length > 0) {
      matches.sort(compareOutboxEntries);
      return matches[matches.length - 1];
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for ${category} email for ${recipient}`);
}

function extractVerificationToken(emailPayload) {
  const source = `${String(emailPayload.text ?? "")}\n${String(emailPayload.html ?? "")}`;
  const match = source.match(/\/signup\/verify\?token=([^&\s\"]+)/i);
  if (!match) {
    throw new Error(`Unable to locate signup verification token in email payload=${JSON.stringify(emailPayload)}`);
  }
  return decodeURIComponent(match[1]);
}

function buildBaseRuntimeEnv(overrides = {}) {
  const env = {
    ...process.env,
    AUTH_MODE: "db",
    PIM_ALLOW_LEGACY_HEADERS: "false",
    FEATURE_PUBLIC_SIGNUP_ENABLED: "true",
    AUTH_EMAIL_PROVIDER: "file",
    PIM_WEB_BASE_URL: "http://localhost:3000",
    ...overrides,
    PIM_AUTH_IDENTITIES_JSON: " ",
    PIM_AUTH_WORKSPACES_JSON: " ",
  };
  return env;
}

async function startApi(env) {
  const baseUrl = `http://127.0.0.1:${env.PORT}/api/v1`;
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
  try {
    await waitForHealth(baseUrl, 60_000);
  } catch (error) {
    if (!processHandle.killed && processHandle.pid) {
      if (process.platform === "win32") {
        try {
          execFileSync("taskkill", ["/pid", String(processHandle.pid), "/t", "/f"], { stdio: "ignore" });
        } catch {
          // ignore cleanup failures
        }
      } else {
        processHandle.kill("SIGTERM");
      }
    }
    const message = error instanceof Error ? error.message : String(error);
    const stdoutTail = stdoutBuffer.join("").slice(-4000);
    const stderrTail = stderrBuffer.join("").slice(-4000);
    throw new Error(
      [
        message,
        stdoutTail ? `--- API stdout tail ---\n${stdoutTail}` : "",
        stderrTail ? `--- API stderr tail ---\n${stderrTail}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  return {
    baseUrl,
    processHandle,
    stdoutBuffer,
    stderrBuffer,
  };
}

async function stopApi(handle) {
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

function buildDbClient(baseEnv) {
  const url = String(baseEnv.DATABASE_URL_POOLED ?? baseEnv.DATABASE_URL ?? "").trim();
  if (!url) {
    throw new Error("DATABASE_URL or DATABASE_URL_POOLED is required for public signup integration tests");
  }
  return new PrismaClient({
    datasources: {
      db: {
        url,
      },
    },
  });
}

async function runFeatureFlagOffCase(baseEnv) {
  const env = buildBaseRuntimeEnv({
    ...baseEnv,
    PORT: String(5600 + Math.floor(Math.random() * 60)),
    FEATURE_PUBLIC_SIGNUP_ENABLED: "false",
    AUTH_EMAIL_PROVIDER: "console",
  });
  const api = await startApi(env);
  try {
    const result = await apiRequest(api.baseUrl, "GET", "/signup/workspace/availability?workspaceSlug=tej-check");
    assertStatus(result, 404, "signup routes hidden when feature flag off");
  } finally {
    await stopApi(api.processHandle);
  }
}

async function runValidationCase(baseEnv) {
  const outboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "tej-pim-signup-validation-"));
  const env = buildBaseRuntimeEnv({
    ...baseEnv,
    PORT: String(5660 + Math.floor(Math.random() * 60)),
    AUTH_EMAIL_OUTBOX_DIR: outboxDir,
  });
  const api = await startApi(env);
  try {
    const invalidSlug = await apiRequest(api.baseUrl, "GET", "/signup/workspace/availability?workspaceSlug=bad_slug");
    assertStatus(invalidSlug, 400, "invalid slug rejected");
    assert(invalidSlug.payload?.error === "WORKSPACE_SLUG_INVALID", `expected WORKSPACE_SLUG_INVALID, got ${JSON.stringify(invalidSlug.payload)}`);

    const missingTerms = await apiRequest(api.baseUrl, "POST", "/signup/workspace", {
      displayName: "Validation Workspace",
      workspaceSlug: `validation-${Date.now().toString().slice(-6)}`,
      adminEmail: `validation-${Date.now().toString().slice(-6)}@example.com`,
      password: "ValidPass#2026",
      acceptedTerms: false,
    });
    assertStatus(missingTerms, 400, "signup request requires accepted terms");
    assert(missingTerms.payload?.error === "TERMS_ACCEPTANCE_REQUIRED", `expected TERMS_ACCEPTANCE_REQUIRED, got ${JSON.stringify(missingTerms.payload)}`);

    const shortPassword = await apiRequest(api.baseUrl, "POST", "/signup/workspace", {
      displayName: "Validation Workspace",
      workspaceSlug: `validation-pw-${Date.now().toString().slice(-6)}`,
      adminEmail: `validation-pw-${Date.now().toString().slice(-6)}@example.com`,
      password: "short",
      acceptedTerms: true,
    });
    assertStatus(shortPassword, 400, "signup request rejects short password");
    assert(shortPassword.payload?.error === "PASSWORD_TOO_SHORT", `expected PASSWORD_TOO_SHORT, got ${JSON.stringify(shortPassword.payload)}`);
  } finally {
    fs.rmSync(outboxDir, { recursive: true, force: true });
    await stopApi(api.processHandle);
  }
}

async function runHappyPathCase(baseEnv) {
  const outboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "tej-pim-signup-happy-"));
  const env = buildBaseRuntimeEnv({
    ...baseEnv,
    PORT: String(5720 + Math.floor(Math.random() * 60)),
    AUTH_EMAIL_OUTBOX_DIR: outboxDir,
  });
  const prisma = buildDbClient(baseEnv);
  const api = await startApi(env);
  const runId = Date.now().toString();
  const workspaceSlug = `tej-${runId.slice(-8)}`;
  const adminEmail = `owner-${runId}@example.com`;
  const password = "Signup#2026";
  const secondWorkspaceSlug = `tej-resend-${runId.slice(-6)}`;
  const secondEmail = `owner-resend-${runId}@example.com`;
  const secondPassword = "Resend#2026";

  try {
    const availability = await apiRequest(api.baseUrl, "GET", `/signup/workspace/availability?workspaceSlug=${workspaceSlug}`);
    assertStatus(availability, 200, "workspace availability succeeds");
    assert(availability.payload?.available === true, `expected workspace to be available. payload=${JSON.stringify(availability.payload)}`);

    const invalidToken = await apiRequest(api.baseUrl, "POST", "/signup/verify", { token: "bogus-token" });
    assertStatus(invalidToken, 401, "invalid verification token rejected");
    assert(invalidToken.payload?.error === "SIGNUP_VERIFICATION_TOKEN_INVALID", `expected invalid token error. payload=${JSON.stringify(invalidToken.payload)}`);

    const createSignup = await apiRequest(api.baseUrl, "POST", "/signup/workspace", {
      displayName: "TEJ Workspace",
      workspaceSlug,
      adminEmail,
      password,
      acceptedTerms: true,
    });
    assertStatus(createSignup, 200, "signup request created");
    assert(createSignup.payload?.status === "pending_verification", `unexpected signup create payload=${JSON.stringify(createSignup.payload)}`);

    const duplicateSlug = await apiRequest(api.baseUrl, "POST", "/signup/workspace", {
      displayName: "Duplicate Slug",
      workspaceSlug,
      adminEmail: `other-${runId}@example.com`,
      password,
      acceptedTerms: true,
    });
    assertStatus(duplicateSlug, 409, "duplicate slug rejected while pending");
    assert(duplicateSlug.payload?.error === "WORKSPACE_SLUG_ALREADY_PENDING", `unexpected duplicate slug payload=${JSON.stringify(duplicateSlug.payload)}`);

    const duplicateEmail = await apiRequest(api.baseUrl, "POST", "/signup/workspace", {
      displayName: "Duplicate Email",
      workspaceSlug: `${workspaceSlug}-b`,
      adminEmail,
      password,
      acceptedTerms: true,
    });
    assertStatus(duplicateEmail, 409, "duplicate email rejected while pending");
    assert(duplicateEmail.payload?.error === "SIGNUP_VERIFICATION_ALREADY_PENDING", `unexpected duplicate email payload=${JSON.stringify(duplicateEmail.payload)}`);

    const preVerifyLogin = await login(api.baseUrl, workspaceSlug, adminEmail, password);
    assertStatus(preVerifyLogin, 404, "workspace not created before verify");
    assert(preVerifyLogin.payload?.error === "WORKSPACE_NOT_FOUND", `unexpected pre-verify login payload=${JSON.stringify(preVerifyLogin.payload)}`);

    const firstEmail = await waitForOutboxEmail(outboxDir, adminEmail, "signup_verification", 10_000);
    const firstToken = extractVerificationToken(firstEmail.parsed);

    const verify = await apiRequest(api.baseUrl, "POST", "/signup/verify", { token: firstToken });
    assertStatus(verify, 200, "signup verification succeeds");
    assert(verify.payload?.workspaceSlug === workspaceSlug, `unexpected verify payload=${JSON.stringify(verify.payload)}`);

    const secondVerify = await apiRequest(api.baseUrl, "POST", "/signup/verify", { token: firstToken });
    assertStatus(secondVerify, 401, "verification token is single-use");
    assert(secondVerify.payload?.error === "SIGNUP_VERIFICATION_TOKEN_INVALID", `unexpected second verify payload=${JSON.stringify(secondVerify.payload)}`);

    const verifiedLogin = await login(api.baseUrl, workspaceSlug, adminEmail, password);
    assertStatus(verifiedLogin, 201, "verified admin can log in");
    assert(String(verifiedLogin.payload?.accessToken ?? "").trim().length > 0, "expected access token after verified login");

    const planProfile = await apiRequest(api.baseUrl, "GET", "/billing/plan-profile", undefined, {
      token: verifiedLogin.payload.accessToken,
    });
    assertStatus(planProfile, 200, "plan profile available after signup verification");
    assert(planProfile.payload?.planTier === "STARTER", `expected STARTER plan, got ${JSON.stringify(planProfile.payload)}`);
    assert(planProfile.payload?.billingStatus === "trial", `expected trial billing status, got ${JSON.stringify(planProfile.payload)}`);
    assert(planProfile.payload?.accessStatus === "active", `expected active access status, got ${JSON.stringify(planProfile.payload)}`);
    assert(
      typeof planProfile.payload?.trialEndsAt === "string" && String(planProfile.payload.trialEndsAt).length > 0,
      `expected trial end date after signup, got ${JSON.stringify(planProfile.payload)}`,
    );

    const signupTrends = await apiRequest(api.baseUrl, "GET", "/metrics/kpi-trends?days=7", undefined, {
      token: verifiedLogin.payload.accessToken,
    });
    assertStatus(signupTrends, 200, "signup metrics trends available");
    assert(Array.isArray(signupTrends.payload?.signupRequests), "expected signupRequests array in KPI trends");
    assert(Array.isArray(signupTrends.payload?.signupVerifications), "expected signupVerifications array in KPI trends");
    assert(Array.isArray(signupTrends.payload?.signupVerificationRate), "expected signupVerificationRate array in KPI trends");
    assert(
      Array.isArray(signupTrends.payload?.signupMedianTimeToVerifyHours),
      "expected signupMedianTimeToVerifyHours array in KPI trends",
    );
    assert(
      signupTrends.payload.signupRequests.some((point) => Number(point.value) >= 1),
      `expected signup request metric point, got ${JSON.stringify(signupTrends.payload)}`,
    );
    assert(
      signupTrends.payload.signupVerifications.some((point) => Number(point.value) >= 1),
      `expected signup verification metric point, got ${JSON.stringify(signupTrends.payload)}`,
    );
    assert(
      signupTrends.payload.signupVerificationRate.some((point) => Number(point.value) > 0),
      `expected non-zero signup verification rate, got ${JSON.stringify(signupTrends.payload)}`,
    );

    const secondSignup = await apiRequest(api.baseUrl, "POST", "/signup/workspace", {
      displayName: "TEJ Resend Workspace",
      workspaceSlug: secondWorkspaceSlug,
      adminEmail: secondEmail,
      password: secondPassword,
      acceptedTerms: true,
    });
    assertStatus(secondSignup, 200, "second signup request created for resend/expiry flow");

    const secondEmailFirst = await waitForOutboxEmail(outboxDir, secondEmail, "signup_verification", 10_000);
    const expiredToken = extractVerificationToken(secondEmailFirst.parsed);

    await prisma.publicSignupRequest.updateMany({
      where: {
        adminEmail: secondEmail,
        status: "pending",
      },
      data: {
        expiresAt: new Date(Date.now() - 60_000),
      },
    });

    const expiredVerify = await apiRequest(api.baseUrl, "POST", "/signup/verify", { token: expiredToken });
    assertStatus(expiredVerify, 401, "expired verification token rejected");
    assert(expiredVerify.payload?.error === "SIGNUP_VERIFICATION_TOKEN_INVALID", `unexpected expired verify payload=${JSON.stringify(expiredVerify.payload)}`);

    const resend = await apiRequest(api.baseUrl, "POST", "/signup/resend-verification", {
      adminEmail: secondEmail,
    });
    assertStatus(resend, 200, "resend verification succeeds");

    const secondEmailResent = await waitForOutboxEmail(outboxDir, secondEmail, "signup_verification", 10_000, secondEmailFirst.file);
    const resentToken = extractVerificationToken(secondEmailResent.parsed);
    assert(resentToken !== expiredToken, "expected resend verification token to rotate");

    const verifyResent = await apiRequest(api.baseUrl, "POST", "/signup/verify", { token: resentToken });
    assertStatus(verifyResent, 200, "resent verification token provisions workspace");

    const resendLogin = await login(api.baseUrl, secondWorkspaceSlug, secondEmail, secondPassword);
    assertStatus(resendLogin, 201, "resent verification admin can log in");
  } finally {
    await prisma.$disconnect();
    fs.rmSync(outboxDir, { recursive: true, force: true });
    await stopApi(api.processHandle);
  }
}

async function runVerificationDeliveryFailureRecoveryCase(baseEnv) {
  const brokenOutboxPath = path.join(os.tmpdir(), `tej-pim-signup-broken-outbox-${Date.now()}.json`);
  fs.writeFileSync(brokenOutboxPath, "broken");
  const failingEnv = buildBaseRuntimeEnv({
    ...baseEnv,
    PORT: String(5750 + Math.floor(Math.random() * 20)),
    AUTH_EMAIL_OUTBOX_DIR: brokenOutboxPath,
  });
  const prisma = buildDbClient(baseEnv);
  const failingApi = await startApi(failingEnv);
  const runId = Date.now().toString();
  const workspaceSlug = `tej-fail-${runId.slice(-8)}`;
  const adminEmail = `signup-fail-${runId}@example.com`;
  const password = "Signup#2026";

  try {
    const failedSignup = await apiRequest(failingApi.baseUrl, "POST", "/signup/workspace", {
      displayName: "TEJ Failed Delivery Workspace",
      workspaceSlug,
      adminEmail,
      password,
      acceptedTerms: true,
    });
    assertStatus(failedSignup, 502, "signup returns dependency failure when verification email send fails");
    assert(
      failedSignup.payload?.error === "SIGNUP_VERIFICATION_SEND_FAILED",
      `unexpected signup delivery failure payload=${JSON.stringify(failedSignup.payload)}`,
    );

    const failedRequest = await prisma.publicSignupRequest.findUnique({
      where: { workspaceSlug },
      select: {
        id: true,
        workspaceSlug: true,
        adminEmail: true,
        status: true,
      },
    });
    assert(failedRequest, "expected signup request record to exist after delivery failure");
    assert(
      failedRequest.status === "delivery_failed",
      `expected signup request to move to delivery_failed after email failure, got ${JSON.stringify(failedRequest)}`,
    );

    const availability = await apiRequest(
      failingApi.baseUrl,
      "GET",
      `/signup/workspace/availability?workspaceSlug=${encodeURIComponent(workspaceSlug)}`,
    );
    assertStatus(availability, 200, "workspace availability check still succeeds after delivery failure");
    assert(
      availability.payload?.available === true,
      `expected failed delivery slug to remain available for retry, got ${JSON.stringify(availability.payload)}`,
    );
  } finally {
    fs.rmSync(brokenOutboxPath, { force: true });
    await stopApi(failingApi.processHandle);
  }

  const goodOutboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "tej-pim-signup-recovery-"));
  const recoveryEnv = buildBaseRuntimeEnv({
    ...baseEnv,
    PORT: String(5770 + Math.floor(Math.random() * 20)),
    AUTH_EMAIL_OUTBOX_DIR: goodOutboxDir,
  });
  const recoveryApi = await startApi(recoveryEnv);

  try {
    const retriedSignup = await apiRequest(recoveryApi.baseUrl, "POST", "/signup/workspace", {
      displayName: "TEJ Failed Delivery Workspace",
      workspaceSlug,
      adminEmail,
      password,
      acceptedTerms: true,
    });
    assertStatus(retriedSignup, 200, "signup can be retried after delivery failure");
    assert(
      retriedSignup.payload?.status === "pending_verification",
      `unexpected retry signup payload=${JSON.stringify(retriedSignup.payload)}`,
    );

    const signupEmail = await waitForOutboxEmail(goodOutboxDir, adminEmail, "signup_verification", 10_000);
    const verificationToken = extractVerificationToken(signupEmail.parsed);

    const verify = await apiRequest(recoveryApi.baseUrl, "POST", "/signup/verify", { token: verificationToken });
    assertStatus(verify, 200, "retried signup verification succeeds");

    const verifiedLogin = await login(recoveryApi.baseUrl, workspaceSlug, adminEmail, password);
    assertStatus(verifiedLogin, 201, "retried signup admin can log in after verification");
  } finally {
    await prisma.$disconnect();
    fs.rmSync(goodOutboxDir, { recursive: true, force: true });
    await stopApi(recoveryApi.processHandle);
  }
}

async function runIpRateLimitCase(baseEnv) {
  const outboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "tej-pim-signup-ip-rate-"));
  const env = buildBaseRuntimeEnv({
    ...baseEnv,
    PORT: String(5780 + Math.floor(Math.random() * 60)),
    AUTH_EMAIL_OUTBOX_DIR: outboxDir,
  });
  const api = await startApi(env);
  const runId = Date.now().toString();
  try {
    for (let index = 0; index < 5; index += 1) {
      const result = await apiRequest(api.baseUrl, "POST", "/signup/workspace", {
        displayName: `IP Limit ${index}`,
        workspaceSlug: `ip-limit-${runId.slice(-5)}-${index}`,
        adminEmail: `ip-limit-${runId}-${index}@example.com`,
        password: "Signup#2026",
        acceptedTerms: true,
      });
      assertStatus(result, 200, `ip rate limit warmup ${index + 1}`);
    }

    const limited = await apiRequest(api.baseUrl, "POST", "/signup/workspace", {
      displayName: "IP Limit 6",
      workspaceSlug: `ip-limit-${runId.slice(-5)}-6`,
      adminEmail: `ip-limit-${runId}-6@example.com`,
      password: "Signup#2026",
      acceptedTerms: true,
    });
    assertStatus(limited, 429, "signup IP rate limit enforced");
    assert(limited.payload?.error === "SIGNUP_RATE_LIMITED", `unexpected ip rate limit payload=${JSON.stringify(limited.payload)}`);
    assert(String(limited.headers.get("x-ratelimit-retry-after") ?? "").trim().length > 0, "expected retry header for IP rate limit");
  } finally {
    fs.rmSync(outboxDir, { recursive: true, force: true });
    await stopApi(api.processHandle);
  }
}

async function runEmailRateLimitCase(baseEnv) {
  const outboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "tej-pim-signup-email-rate-"));
  const env = buildBaseRuntimeEnv({
    ...baseEnv,
    PORT: String(5840 + Math.floor(Math.random() * 60)),
    AUTH_EMAIL_OUTBOX_DIR: outboxDir,
  });
  const api = await startApi(env);
  const runId = Date.now().toString();
  const adminEmail = `email-limit-${runId}@example.com`;
  try {
    for (let index = 0; index < 3; index += 1) {
      const result = await apiRequest(api.baseUrl, "POST", "/signup/workspace", {
        displayName: `Email Limit ${index}`,
        workspaceSlug: `email-limit-${runId.slice(-5)}-${index}`,
        adminEmail,
        password: "Signup#2026",
        acceptedTerms: true,
      });
      if (index === 0) {
        assertStatus(result, 200, "email rate limit first signup request succeeds");
      } else {
        assertStatus(result, 409, `email rate limit warmup duplicate ${index + 1}`);
      }
    }

    const limited = await apiRequest(api.baseUrl, "POST", "/signup/workspace", {
      displayName: "Email Limit 4",
      workspaceSlug: `email-limit-${runId.slice(-5)}-4`,
      adminEmail,
      password: "Signup#2026",
      acceptedTerms: true,
    });
    assertStatus(limited, 429, "signup email rate limit enforced");
    assert(limited.payload?.error === "SIGNUP_RATE_LIMITED", `unexpected email rate limit payload=${JSON.stringify(limited.payload)}`);
    assert(String(limited.headers.get("x-ratelimit-retry-after") ?? "").trim().length > 0, "expected retry header for email rate limit");
  } finally {
    fs.rmSync(outboxDir, { recursive: true, force: true });
    await stopApi(api.processHandle);
  }
}

async function runResendRateLimitCase(baseEnv) {
  const outboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "tej-pim-signup-resend-rate-"));
  const env = buildBaseRuntimeEnv({
    ...baseEnv,
    PORT: String(5900 + Math.floor(Math.random() * 60)),
    AUTH_EMAIL_OUTBOX_DIR: outboxDir,
  });
  const api = await startApi(env);
  const runId = Date.now().toString();
  const workspaceSlug = `resend-limit-${runId.slice(-6)}`;
  const adminEmail = `resend-limit-${runId}@example.com`;
  try {
    const createSignup = await apiRequest(api.baseUrl, "POST", "/signup/workspace", {
      displayName: "Resend Rate Limit",
      workspaceSlug,
      adminEmail,
      password: "Signup#2026",
      acceptedTerms: true,
    });
    assertStatus(createSignup, 200, "resend rate-limit warmup signup succeeds");

    for (let index = 0; index < 2; index += 1) {
      const resend = await apiRequest(api.baseUrl, "POST", "/signup/resend-verification", {
        adminEmail,
      });
      assertStatus(resend, 200, `resend verification warmup ${index + 1}`);
    }

    const limited = await apiRequest(api.baseUrl, "POST", "/signup/resend-verification", {
      adminEmail,
    });
    assertStatus(limited, 429, "resend verification rate limit enforced");
    assert(limited.payload?.error === "SIGNUP_RATE_LIMITED", `unexpected resend rate limit payload=${JSON.stringify(limited.payload)}`);
    assert(
      String(limited.headers.get("x-ratelimit-retry-after") ?? "").trim().length > 0,
      "expected retry header for resend rate limit",
    );
  } finally {
    fs.rmSync(outboxDir, { recursive: true, force: true });
    await stopApi(api.processHandle);
  }
}

async function runConcurrentDuplicateCase(baseEnv) {
  const outboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "tej-pim-signup-concurrent-"));
  const env = buildBaseRuntimeEnv({
    ...baseEnv,
    PORT: String(5960 + Math.floor(Math.random() * 60)),
    AUTH_EMAIL_OUTBOX_DIR: outboxDir,
  });
  const prisma = buildDbClient(baseEnv);
  const api = await startApi(env);
  const runId = Date.now().toString();
  const workspaceSlug = `concurrent-${runId.slice(-6)}`;
  const adminEmail = `concurrent-${runId}@example.com`;

  try {
    const [first, second] = await Promise.all([
      apiRequest(api.baseUrl, "POST", "/signup/workspace", {
        displayName: "Concurrent Signup",
        workspaceSlug,
        adminEmail,
        password: "Signup#2026",
        acceptedTerms: true,
      }),
      apiRequest(api.baseUrl, "POST", "/signup/workspace", {
        displayName: "Concurrent Signup",
        workspaceSlug,
        adminEmail,
        password: "Signup#2026",
        acceptedTerms: true,
      }),
    ]);

    const statuses = [first.status, second.status].sort((left, right) => left - right);
    assert(
      statuses[0] === 200 && statuses[1] === 409,
      `expected one success and one conflict for concurrent signup, got ${JSON.stringify([first.payload, second.payload])}`,
    );

    const matchingRequests = await prisma.publicSignupRequest.findMany({
      where: {
        OR: [{ workspaceSlug }, { adminEmail }],
      },
    });
    assert(matchingRequests.length === 1, `expected one pending signup request after concurrent create, got ${matchingRequests.length}`);
    assert(matchingRequests[0]?.status === "pending", `expected surviving signup request to stay pending, got ${JSON.stringify(matchingRequests[0])}`);
  } finally {
    await prisma.$disconnect();
    fs.rmSync(outboxDir, { recursive: true, force: true });
    await stopApi(api.processHandle);
  }
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const baseEnv = { ...process.env };
  await runFeatureFlagOffCase(baseEnv);
  await runValidationCase(baseEnv);
  await runHappyPathCase(baseEnv);
  await runVerificationDeliveryFailureRecoveryCase(baseEnv);
  await runIpRateLimitCase(baseEnv);
  await runEmailRateLimitCase(baseEnv);
  await runResendRateLimitCase(baseEnv);
  await runConcurrentDuplicateCase(baseEnv);

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "feature_flag_off_returns_404",
          "signup_validation_returns_explicit_errors",
          "signup_happy_path_creates_pending_request",
          "signup_delivery_failure_marks_request_non_pending_and_allows_retry",
          "signup_verify_provisions_workspace_and_admin",
          "verified_admin_can_login_and_has_starter_plan",
          "signup_kpi_trends_expose_request_verification_and_conversion_metrics",
          "duplicate_slug_and_email_are_rejected",
          "expired_token_is_rejected",
          "resend_verification_rotates_token",
          "signup_ip_rate_limit_returns_429",
          "signup_email_rate_limit_returns_429",
          "resend_verification_rate_limit_returns_429",
          "concurrent_duplicate_signup_leaves_single_pending_request",
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

run().catch((error) => {
  console.error("Public signup integration test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
