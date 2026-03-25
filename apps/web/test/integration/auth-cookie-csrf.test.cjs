#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
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
  setDefaultEnv("FEATURE_REAL_SPAPI_VALIDATION", "false");
  setDefaultEnv("PIM_AUTH_PASSWORD", "tej-pim-demo-password");
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
    await sleep(500);
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

async function requestWeb(baseUrl, method, route, cookieJar, body, extraHeaders) {
  const headers = {
    Accept: "application/json",
    ...(extraHeaders ?? {}),
  };
  const cookieValue = cookieHeader(cookieJar);
  if (cookieValue) {
    headers.Cookie = cookieValue;
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
  const setCookieHeaders = getSetCookieHeaders(response);
  applySetCookie(cookieJar, setCookieHeaders);
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return {
    status: response.status,
    payload,
    setCookieHeaders,
  };
}

function assertStatus(result, expected, message) {
  if (result.status !== expected) {
    throw new Error(
      `${message}. expected=${expected} actual=${result.status} payload=${JSON.stringify(result.payload)}`,
    );
  }
}

function resolveCookie(cookieJar, name) {
  return cookieJar.get(name) ?? "";
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build`);
  }

  const runId = Date.now().toString();
  const apiPort = 5600 + Math.floor(Math.random() * 100);
  const webPort = 5700 + Math.floor(Math.random() * 100);
  const apiBaseUrl = `http://127.0.0.1:${apiPort}/api/v1`;
  const webBaseUrl = `http://127.0.0.1:${webPort}`;
  const tenantId = `web-auth-${runId}`;
  const workspaceSlug = `web-${runId}`;
  const userId = `web-user-${runId}@example.com`;

  const apiEnv = {
    ...process.env,
    PORT: String(apiPort),
    AUTH_MODE: "local",
    PIM_ALLOW_LEGACY_HEADERS: "false",
    PIM_DEFAULT_TENANT_KEY: tenantId,
    PIM_DEFAULT_WORKSPACE_SLUG: workspaceSlug,
    PIM_DEFAULT_ROLE: "admin",
    PIM_AUTH_IDENTITIES_JSON: JSON.stringify({
      [userId]: { tenantId, role: "admin", workspaceSlug },
    }),
  };
  const webEnv = {
    ...process.env,
    PORT: String(webPort),
    PIM_API_BASE_URL: apiBaseUrl,
    NODE_ENV: "production",
  };

  const apiStdout = [];
  const apiStderr = [];
  const webStdout = [];
  const webStderr = [];

  const apiProcess = spawn("node", [API_ENTRY], {
    cwd: REPO_ROOT,
    env: apiEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });
  apiProcess.stdout.on("data", (chunk) => {
    apiStdout.push(String(chunk));
    if (apiStdout.length > 200) apiStdout.shift();
  });
  apiProcess.stderr.on("data", (chunk) => {
    apiStderr.push(String(chunk));
    if (apiStderr.length > 200) apiStderr.shift();
  });

  const webProcess = spawn(
    "cmd.exe",
    ["/d", "/s", "/c", `npx next start -p ${webPort} -H 127.0.0.1`],
    {
      cwd: path.join(REPO_ROOT, "apps", "web"),
      env: webEnv,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  webProcess.stdout.on("data", (chunk) => {
    webStdout.push(String(chunk));
    if (webStdout.length > 200) webStdout.shift();
  });
  webProcess.stderr.on("data", (chunk) => {
    webStderr.push(String(chunk));
    if (webStderr.length > 200) webStderr.shift();
  });

  try {
    await waitForHttp(`${apiBaseUrl}/health`, 60_000);
    await waitForHttp(`${webBaseUrl}/login`, 60_000);

    const jar = new Map();
    const login = await requestWeb(
      webBaseUrl,
      "POST",
      "/api/auth/login",
      jar,
      {
        userId,
        workspaceSlug,
        role: "admin",
        password: process.env.PIM_AUTH_PASSWORD,
        expiresInMinutes: 30,
      },
      undefined,
    );
    assertStatus(login, 201, "Web login failed");

    const csrfToken = resolveCookie(jar, "pim_csrf_token");
    const accessToken = resolveCookie(jar, "pim_access_token");
    if (!csrfToken || !accessToken) {
      throw new Error("Login did not set required cookies (pim_access_token + pim_csrf_token).");
    }
    const accessCookieHeader = login.setCookieHeaders.find((header) => header.startsWith("pim_access_token="));
    const csrfCookieHeader = login.setCookieHeaders.find((header) => header.startsWith("pim_csrf_token="));
    if (!accessCookieHeader || !csrfCookieHeader) {
      throw new Error("Login response did not include pim_access_token and pim_csrf_token set-cookie headers.");
    }
    const appEnv = String(webEnv.APP_ENV ?? "").trim().toLowerCase();
    const expectSecure = appEnv === "production";
    const accessSecure = /;\s*secure\b/i.test(accessCookieHeader);
    const csrfSecure = /;\s*secure\b/i.test(csrfCookieHeader);
    if (accessSecure !== expectSecure || csrfSecure !== expectSecure) {
      throw new Error(
        `Cookie secure flag mismatch for APP_ENV=${appEnv || "unset"} (expected ${expectSecure}). access=${accessSecure}, csrf=${csrfSecure}`,
      );
    }

    const consentNoCsrf = await requestWeb(
      webBaseUrl,
      "POST",
      "/api/auth/consent",
      jar,
      { accepted: true, policyVersion: "dpdp-v1", purpose: "catalog_operations" },
      undefined,
    );
    assertStatus(consentNoCsrf, 403, "Consent without CSRF should fail");

    const consentWithCsrf = await requestWeb(
      webBaseUrl,
      "POST",
      "/api/auth/consent",
      jar,
      { accepted: true, policyVersion: "dpdp-v1", purpose: "catalog_operations" },
      { "x-csrf-token": csrfToken },
    );
    assertStatus(consentWithCsrf, 200, "Consent with CSRF should pass");

    const logoutNoCsrf = await requestWeb(webBaseUrl, "POST", "/api/auth/logout", jar, undefined, undefined);
    assertStatus(logoutNoCsrf, 403, "Logout without CSRF should fail");

    const logoutWithCsrf = await requestWeb(
      webBaseUrl,
      "POST",
      "/api/auth/logout",
      jar,
      undefined,
      { "x-csrf-token": csrfToken },
    );
    assertStatus(logoutWithCsrf, 204, "Logout with CSRF should pass");

    const postLogoutStatus = await requestWeb(
      webBaseUrl,
      "GET",
      "/api/account/privacy-status",
      jar,
      undefined,
      undefined,
    );
    assertStatus(postLogoutStatus, 401, "Privacy status should require auth after logout");

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantId,
          workspaceSlug,
          userId,
          validated: [
            "login_sets_auth_and_csrf_cookies",
            "login_cookie_secure_flag_matches_app_env",
            "consent_without_csrf_is_403",
            "consent_with_csrf_is_200",
            "logout_without_csrf_is_403",
            "logout_with_csrf_is_204",
            "post_logout_status_is_401",
          ],
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("Web auth cookie/csrf integration test failed:");
    console.error(message);
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
    for (const proc of [webProcess, apiProcess]) {
      if (!proc.killed && proc.pid) {
        if (process.platform === "win32") {
          try {
            execFileSync("taskkill", ["/pid", String(proc.pid), "/t", "/f"], { stdio: "ignore" });
          } catch {
            // ignore cleanup errors
          }
        } else {
          proc.kill("SIGTERM");
        }
      }
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
