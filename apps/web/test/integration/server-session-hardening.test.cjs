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

function run() {
  const sessionSource = read("apps/web/src/lib/server-session.ts");
  const developerActionsSource = read("apps/web/src/app/internal/developer/actions.ts");

  assert(
    sessionSource.includes('throw new Error("JWT_SECRET or PIM_JWT_SECRET is required for verified web sessions.")'),
    "Server session handling must fail closed when JWT verification secrets are missing in staging/production.",
  );
  assert(
    sessionSource.includes('return appEnv === "staging" || appEnv === "production";'),
    "Server session handling must explicitly treat staging and production as verified-session environments.",
  );
  assert(
    !sessionSource.includes("return parseUnverifiedToken(token);"),
    "Server session handling must never trust unverified JWT payloads.",
  );
  assert(
    developerActionsSource.includes('process.env.APP_ENV === "production"'),
    "Internal developer actions must repeat the production guard instead of relying on page-only gating.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "server_sessions_fail_closed_without_verification_secret",
          "server_sessions_never_parse_unverified_jwt_claims",
          "developer_actions_repeat_production_guard",
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
  console.error("Server session hardening test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
