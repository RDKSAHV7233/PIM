#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const LAYOUT = path.join(REPO_ROOT, "apps", "web", "src", "app", "layout.tsx");
const AUTHENTICATED_SHELL = path.join(REPO_ROOT, "apps", "web", "src", "components", "nav", "authenticated-shell.tsx");
const LOGIN = path.join(REPO_ROOT, "apps", "web", "src", "components", "auth", "login-page-client.tsx");
const SERVER_AUTH = path.join(REPO_ROOT, "apps", "web", "src", "lib", "server-auth.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const layoutSource = fs.readFileSync(LAYOUT, "utf8");
  const shellSource = fs.readFileSync(AUTHENTICATED_SHELL, "utf8");
  const loginSource = fs.readFileSync(LOGIN, "utf8");
  const serverAuthSource = fs.readFileSync(SERVER_AUTH, "utf8");

  assert(
      layoutSource.includes("hasServerAuthToken") &&
      layoutSource.includes("const hasAuthToken = await hasServerAuthToken();") &&
      layoutSource.includes("<AuthenticatedShell actorRole={actorRole}") &&
      shellSource.includes("<LogoutButton />") &&
      layoutSource.includes("{hasAuthToken ? ("),
    "Root layout must render the authenticated shell from auth-token presence, not only session claims.",
  );
  assert(
    serverAuthSource.includes("export async function hasServerAuthToken()"),
    "Server auth helper must expose auth-token presence detection.",
  );
  assert(
    loginSource.includes("window.location.assign(safeNextPath);"),
    "Login client must use a full navigation after successful login so the authenticated shell renders immediately.",
  );
  assert(
    loginSource.includes("authCopy.workspaceLabel") &&
      loginSource.includes("id=\"workspace\"") &&
      loginSource.includes("workspaceSlug") &&
      loginSource.includes("workspaceNotFound"),
    "Login client must collect a workspace slug and handle workspace-specific errors before sign-in succeeds.",
  );

  console.log(JSON.stringify({
    status: "ok",
    validated: [
      "root_layout_uses_auth_token_for_shell",
      "server_auth_exposes_token_presence_helper",
      "login_redirect_uses_full_navigation",
      "login_collects_workspace_slug"
    ],
    checkedAt: new Date().toISOString()
  }, null, 2));
}

try {
  run();
} catch (error) {
  console.error("Auth shell UI test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
