#!/usr/bin/env node
/* eslint-disable no-console */
const path = require("node:path");
const fs = require("node:fs");
const crypto = require("node:crypto");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const JWT_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "auth", "jwt.js");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function loadJwt() {
  Object.keys(require.cache).forEach((key) => {
    if (key.includes(path.sep + "jwt.js")) {
      delete require.cache[key];
    }
  });
  return require(JWT_ENTRY);
}

function prepareEnv() {
  process.env.JWT_SECRET = `test-secret-auth-config-${crypto.randomUUID()}`;
  process.env.AUTH_MODE = "local";
  process.env.PIM_DEFAULT_TENANT_KEY = "default";
  process.env.PIM_DEFAULT_WORKSPACE_SLUG = "default";
  process.env.PIM_DEFAULT_ROLE = "viewer";
  process.env.PIM_AUTH_WORKSPACES_JSON = JSON.stringify({
    default: { tenantId: "default", displayName: "Default" },
  });
  process.env.PIM_AUTH_IDENTITIES_JSON = JSON.stringify({
    "admin@example.com": { tenantId: "default", role: "admin" },
  });
}

function run() {
  if (!fs.existsSync(JWT_ENTRY)) {
    throw new Error(`Compiled module not found at ${JWT_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  prepareEnv();
  const { signPimJwt, verifyPimJwt } = loadJwt();
  const token = signPimJwt({
    sub: "admin@example.com",
    tenantId: "default",
    role: "admin",
    expiresInSeconds: 3600,
  });
  const claims = verifyPimJwt(token);
  assert(claims !== null, "fresh token must verify");
  assert(claims.authConfigFingerprint, "fresh token must carry an auth config fingerprint");

  process.env.PIM_AUTH_IDENTITIES_JSON = JSON.stringify({
    "admin@example.com": { tenantId: "default", role: "viewer" },
  });
  const staleClaims = verifyPimJwt(token);
  assert(staleClaims === null, "token must be rejected after auth config changes");

  process.env.PIM_AUTH_IDENTITIES_JSON = JSON.stringify({
    "admin@example.com": { tenantId: "default", role: "admin" },
  });
  const reissuedToken = signPimJwt({
    sub: "admin@example.com",
    tenantId: "default",
    role: "admin",
    expiresInSeconds: 3600,
  });
  assert(verifyPimJwt(reissuedToken) !== null, "reissued token must verify after config settles");

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "jwt_tokens_capture_auth_config_fingerprint",
          "jwt_tokens_reject_after_auth_config_change",
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
  console.error("Auth config fingerprint test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
