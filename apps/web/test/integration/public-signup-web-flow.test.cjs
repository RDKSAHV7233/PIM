#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, execFileSync, spawnSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");
const WEB_DIR = path.join(REPO_ROOT, "apps", "web");

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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { method: "GET" });
      if (response.status < 500) {
        return;
      }
    } catch {
      // retry
    }
    await sleep(400);
  }
  throw new Error(`Service did not become ready: ${url}`);
}

function getSetCookieHeaders(response) {
  if (typeof response.headers.getSetCookie === "function") {
    return response.headers.getSetCookie();
  }
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

function applySetCookie(cookieJar, setCookieHeaders) {
  for (const header of setCookieHeaders) {
    const first = String(header).split(";")[0] ?? "";
    const eqIndex = first.indexOf("=");
    if (eqIndex <= 0) {
      continue;
    }
    const name = first.slice(0, eqIndex).trim();
    const value = first.slice(eqIndex + 1);
    if (!name) {
      continue;
    }
    if (!value) {
      cookieJar.delete(name);
      continue;
    }
    cookieJar.set(name, value);
  }
}

function cookieHeader(cookieJar) {
  return Array.from(cookieJar.entries())
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
}

async function request(baseUrl, method, route, body, cookieJar = null, extraHeaders = {}) {
  const headers = { Accept: "application/json", ...extraHeaders };
  if (cookieJar) {
    const cookieValue = cookieHeader(cookieJar);
    if (cookieValue) {
      headers.Cookie = cookieValue;
    }
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
  const setCookieHeaders = getSetCookieHeaders(response);
  if (cookieJar) {
    applySetCookie(cookieJar, setCookieHeaders);
  }
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return { status: response.status, payload, headers: response.headers, setCookieHeaders, text };
}

function compareOutboxEntries(left, right) {
  const leftTime = new Date(left.parsed?.writtenAt ?? 0).getTime();
  const rightTime = new Date(right.parsed?.writtenAt ?? 0).getTime();
  if (leftTime !== rightTime) {
    return leftTime - rightTime;
  }
  return left.file.localeCompare(right.file);
}

function npmInvocation(args) {
  if (process.platform === "win32") {
    const commandLine = ["npm", ...args].join(" ");
    return {
      command: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", commandLine],
    };
  }
  return {
    command: "npm",
    args,
  };
}

async function waitForOutboxEmail(outboxDir, recipient, category, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const files = fs.existsSync(outboxDir) ? fs.readdirSync(outboxDir) : [];
    const matches = [];
    for (const file of files) {
      const fullPath = path.join(outboxDir, file);
      const parsed = JSON.parse(fs.readFileSync(fullPath, "utf8"));
      if (
        String(parsed.to ?? "").trim().toLowerCase() === recipient.toLowerCase() &&
        String(parsed.category ?? "").trim() === category
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

function startProcess(command, args, cwd, env, stdoutBuffer, stderrBuffer) {
  const child = spawn(command, args, {
    cwd,
    env,
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });
  child.stdout.on("data", (chunk) => {
    stdoutBuffer.push(String(chunk));
    if (stdoutBuffer.length > 200) stdoutBuffer.shift();
  });
  child.stderr.on("data", (chunk) => {
    stderrBuffer.push(String(chunk));
    if (stderrBuffer.length > 200) stderrBuffer.shift();
  });
  return child;
}

function stopProcess(proc) {
  if (!proc || proc.killed || !proc.pid) {
    return;
  }
  if (process.platform === "win32") {
    try {
      execFileSync("taskkill", ["/pid", String(proc.pid), "/t", "/f"], { stdio: "ignore" });
    } catch {
      // ignore cleanup failures
    }
    return;
  }
  proc.kill("SIGTERM");
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build`);
  }

  const webBuildCommand = npmInvocation(["run", "build", "--workspace", "@pim1/web"]);
  const webBuild = spawnSync(webBuildCommand.command, webBuildCommand.args, {
    cwd: REPO_ROOT,
    shell: false,
    stdio: "inherit",
    env: {
      ...process.env,
      NEXT_PUBLIC_FEATURE_PUBLIC_SIGNUP_ENABLED: "true",
      FEATURE_PUBLIC_SIGNUP_ENABLED: "true",
    },
  });
  if (webBuild.status !== 0) {
    process.exit(webBuild.status ?? 1);
  }

  const runId = Date.now().toString();
  const apiPort = 5900 + Math.floor(Math.random() * 80);
  const webPort = 6000 + Math.floor(Math.random() * 80);
  const apiBaseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const webBaseUrl = `http://127.0.0.1:${webPort}`;
  const outboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "vexa-pim-signup-web-"));
  const workspaceSlug = `tej-web-${runId.slice(-8)}`;
  const adminEmail = `tej-web-${runId}@example.com`;
  const password = "Signup#2026";

  const apiEnv = {
    ...process.env,
    PORT: String(apiPort),
    AUTH_MODE: "db",
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_AUTH_IDENTITIES_JSON: " ",
    PIM_AUTH_WORKSPACES_JSON: " ",
    FEATURE_PUBLIC_SIGNUP_ENABLED: "true",
    AUTH_EMAIL_PROVIDER: "file",
    AUTH_EMAIL_OUTBOX_DIR: outboxDir,
    PIM_WEB_BASE_URL: webBaseUrl,
  };
  const webEnv = {
    ...process.env,
    PORT: String(webPort),
    PIM_API_BASE_URL: apiBaseUrl,
    FEATURE_PUBLIC_SIGNUP_ENABLED: "true",
    NEXT_PUBLIC_FEATURE_PUBLIC_SIGNUP_ENABLED: "true",
  };

  const apiStdout = [];
  const apiStderr = [];
  const webStdout = [];
  const webStderr = [];
  const apiProcess = startProcess("node", [API_ENTRY], REPO_ROOT, apiEnv, apiStdout, apiStderr);
  const webStartCommand = npmInvocation(["run", "start", "--workspace", "@pim1/web", "--", "-p", String(webPort), "-H", "127.0.0.1"]);
  const webProcess = startProcess(
    webStartCommand.command,
    webStartCommand.args,
    REPO_ROOT,
    webEnv,
    webStdout,
    webStderr,
  );

  try {
    await waitForHttp(`${apiBaseUrl}/health`, 60_000);
    await waitForHttp(`${webBaseUrl}/signup`, 60_000);

    const signupPage = await request(webBaseUrl, "GET", "/signup", undefined, null);
    assertStatus(signupPage, 200, "signup page renders");
    assert(
      String(signupPage.text).includes("Create your Vexa PIM workspace"),
      "Expected signup page to include the workspace creation heading.",
    );

    const cookieJar = new Map();
    const signupRequest = await request(
      webBaseUrl,
      "POST",
      "/api/signup/workspace",
      {
        displayName: "Vexa Web Signup Workspace",
        workspaceSlug,
        adminEmail,
        password,
        acceptedTerms: true,
      },
      cookieJar,
    );
    assertStatus(signupRequest, 200, "web signup request");
    assert(signupRequest.payload?.status === "pending_verification", "Expected pending_verification from web signup route.");

    const signupEmail = await waitForOutboxEmail(outboxDir, adminEmail, "signup_verification", 10_000);
    const verificationToken = extractVerificationToken(signupEmail.parsed);

    const verifyPage = await request(
      webBaseUrl,
      "GET",
      `/signup/verify?token=${encodeURIComponent(verificationToken)}&email=${encodeURIComponent(adminEmail)}&workspace=${encodeURIComponent(workspaceSlug)}`,
      undefined,
      null,
    );
    assertStatus(verifyPage, 200, "signup verify page renders");
    assert(
      String(verifyPage.text).includes("Verify your workspace"),
      "Expected signup verify page to render the verification screen.",
    );

    const verifyRequest = await request(webBaseUrl, "POST", "/api/signup/verify", { token: verificationToken }, cookieJar);
    assertStatus(verifyRequest, 200, "web signup verify request");
    assert(verifyRequest.payload?.workspaceSlug === workspaceSlug, "Expected verification payload to return the workspace slug.");

    const loginRequest = await request(
      webBaseUrl,
      "POST",
      "/api/auth/login",
      {
        workspaceSlug,
        userId: adminEmail,
        password,
        expiresInMinutes: 30,
      },
      cookieJar,
    );
    assertStatus(loginRequest, 201, "web login after signup verify");
    assert(String(loginRequest.payload?.userId ?? "").trim().toLowerCase() === adminEmail, "Expected login payload to return the new admin email.");
    assert(cookieJar.get("pim_access_token"), "Expected web login to set pim_access_token cookie.");
    assert(cookieJar.get("pim_csrf_token"), "Expected web login to set pim_csrf_token cookie.");

    const billingUsage = await request(webBaseUrl, "GET", "/api/billing/usage", undefined, cookieJar, {
      "x-csrf-token": cookieJar.get("pim_csrf_token") ?? "",
    });
    assertStatus(billingUsage, 200, "billing usage after signup");
    assert(String(billingUsage.payload?.planTier ?? "") === "STARTER", "Expected self-serve signup tenant to resolve to STARTER.");
    assert(String(billingUsage.payload?.billingStatus ?? "") === "trial", "Expected self-serve signup tenant to start in trial status.");
    assert(String(billingUsage.payload?.accessStatus ?? "") === "active", "Expected self-serve signup tenant to start with active access.");
    assert(
      typeof billingUsage.payload?.profile?.trialEndsAt === "string" && String(billingUsage.payload.profile.trialEndsAt).length > 0,
      "Expected self-serve signup tenant to receive a trial end date.",
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          workspaceSlug,
          adminEmail,
          validated: [
            "signup_page_renders_when_feature_enabled",
            "web_signup_route_creates_pending_signup",
            "verification_email_is_written_to_outbox",
            "signup_verify_page_renders_from_email_link",
            "web_signup_verify_route_provisions_workspace",
            "new_admin_can_login_through_web_auth_route",
            "verified_workspace_resolves_to_starter_plan",
          ],
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    console.error("Public signup web flow integration test failed:");
    console.error(details);
    if (apiStdout.length) {
      console.error("--- API stdout tail ---");
      console.error(apiStdout.join("").slice(-4000));
    }
    if (apiStderr.length) {
      console.error("--- API stderr tail ---");
      console.error(apiStderr.join("").slice(-4000));
    }
    if (webStdout.length) {
      console.error("--- WEB stdout tail ---");
      console.error(webStdout.join("").slice(-4000));
    }
    if (webStderr.length) {
      console.error("--- WEB stderr tail ---");
      console.error(webStderr.join("").slice(-4000));
    }
    process.exitCode = 1;
  } finally {
    fs.rmSync(outboxDir, { recursive: true, force: true });
    stopProcess(webProcess);
    stopProcess(apiProcess);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
