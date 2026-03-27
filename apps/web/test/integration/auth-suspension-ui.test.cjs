#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const AUTH_REDIRECT = path.join(REPO_ROOT, "apps", "web", "src", "lib", "auth-redirect.ts");
const AUTH_COPY = path.join(REPO_ROOT, "apps", "web", "src", "components", "auth", "auth-copy.ts");
const LOGIN = path.join(REPO_ROOT, "apps", "web", "src", "components", "auth", "login-page-client.tsx");
const LOGOUT_ROUTE = path.join(REPO_ROOT, "apps", "web", "src", "app", "api", "auth", "logout", "route.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const authRedirectSource = fs.readFileSync(AUTH_REDIRECT, "utf8");
  const authCopySource = fs.readFileSync(AUTH_COPY, "utf8");
  const loginSource = fs.readFileSync(LOGIN, "utf8");
  const logoutRouteSource = fs.readFileSync(LOGOUT_ROUTE, "utf8");

  assert(
    authRedirectSource.includes('"tenant_suspended"') &&
      authRedirectSource.includes('extractErrorCode(body) === "TENANT_SUSPENDED"'),
    "Auth redirect helper must preserve tenant suspension as a distinct login reason.",
  );
  assert(
    authCopySource.includes("loginReasonTenantSuspended") &&
      authCopySource.includes("workspace is temporarily suspended"),
    "Auth copy must include a dedicated suspended-workspace message.",
  );
  assert(
    loginSource.includes('reason === "tenant_suspended"') &&
      loginSource.includes('payload.error === "TENANT_SUSPENDED"') &&
      loginSource.includes("authCopy.loginReasonTenantSuspended"),
    "Login client must show the suspended-workspace message for redirects and direct login responses.",
  );
  assert(
    logoutRouteSource.includes('parsed?.error === "TENANT_SUSPENDED"') &&
      logoutRouteSource.includes("clearAuthCookies"),
    "Logout web route must clear auth cookies when the backend rejects a suspended tenant token.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "auth_redirect_preserves_tenant_suspended_reason",
          "auth_copy_exposes_suspended_workspace_message",
          "login_client_handles_tenant_suspended_redirect_and_response",
          "logout_route_clears_cookies_for_suspended_tenant",
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

try {
  run();
} catch (error) {
  console.error("Auth suspension UI test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
