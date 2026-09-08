#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  const loginRoute = read("apps/web/src/app/api/auth/login/route.ts");
  const loginClient = read("apps/web/src/components/auth/login-page-client.tsx");
  const authCopy = read("apps/web/src/components/auth/auth-copy.ts");

  assert(
    loginRoute.includes("let response: Response;") &&
      loginRoute.includes("const apiBaseUrl = getApiBaseUrl();") &&
      loginRoute.includes("catch (error) {") &&
      loginRoute.includes('error: "AUTH_UPSTREAM_UNAVAILABLE"') &&
      loginRoute.includes("status: 503"),
    "Login proxy route must catch upstream fetch failures and return safe AUTH_UPSTREAM_UNAVAILABLE with HTTP 503.",
  );

  assert(
    loginClient.includes("response.status === 503") &&
      loginClient.includes('payload.error === "AUTH_UPSTREAM_UNAVAILABLE"') &&
      loginClient.includes("authCopy.loginServiceUnavailable"),
    "Login page client must map AUTH_UPSTREAM_UNAVAILABLE to the dedicated service-unavailable copy.",
  );

  assert(
    authCopy.includes("loginServiceUnavailable: string;") &&
      authCopy.includes('loginServiceUnavailable: "Sign-in is temporarily unavailable. Please try again in a few minutes."'),
    "Auth copy must declare and populate the service-unavailable login message.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "login_proxy_catches_upstream_auth_failures",
          "login_proxy_returns_auth_upstream_unavailable_503",
          "login_ui_maps_upstream_error_to_service_unavailable_copy",
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error("Auth upstream-unavailable integration test failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
