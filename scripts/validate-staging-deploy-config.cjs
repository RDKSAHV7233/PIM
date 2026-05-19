#!/usr/bin/env node
/* eslint-disable no-console */

const path = require("node:path");
const { resolveConfig } = require("./railway-deploy.cjs");

const LEGACY_BLOCKED_SERVICE_NAMES = new Set(["pim1"]);

function optionalEnv(name, env = process.env) {
  return String(env[name] ?? "").trim();
}

function normalizeBoolean(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (normalized === "true") {
    return true;
  }
  if (normalized === "false") {
    return false;
  }
  throw new Error(`Invalid boolean value '${value}' (expected true or false).`);
}

function parseUrl(name, rawValue, { allowEmpty = false, requireRootPath = false } = {}) {
  const value = String(rawValue ?? "").trim();
  if (!value) {
    if (allowEmpty) {
      return null;
    }
    throw new Error(`Missing required environment variable: ${name}`);
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`Invalid URL for ${name}: ${value}`);
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error(`${name} must use http or https: ${value}`);
  }
  if (requireRootPath) {
    const pathname = parsed.pathname.replace(/\/+$/, "");
    if (pathname && pathname !== "/") {
      throw new Error(`${name} must point at the service root, not a nested path: ${value}`);
    }
  }
  parsed.search = "";
  parsed.hash = "";
  return parsed;
}

function assertNoLegacyServiceNames(env = process.env) {
  const candidates = [
    ["RAILWAY_API_SERVICE", optionalEnv("RAILWAY_API_SERVICE", env)],
    ["RAILWAY_WEB_SERVICE", optionalEnv("RAILWAY_WEB_SERVICE", env)],
  ];

  for (const [name, value] of candidates) {
    if (!value) {
      continue;
    }
    if (LEGACY_BLOCKED_SERVICE_NAMES.has(value.trim().toLowerCase())) {
      throw new Error(`${name}='${value}' is a blocked legacy Railway service name. Update the secret to the live service name.`);
    }
  }
}

function main(env = process.env) {
  const repoRoot = path.resolve(__dirname, "..");
  const config = resolveConfig(env, repoRoot);
  assertNoLegacyServiceNames(env);

  const stagingBaseUrl = parseUrl("STAGING_BASE_URL", optionalEnv("STAGING_BASE_URL", env), {
    requireRootPath: true,
  });
  const stagingWebUrl = parseUrl("STAGING_WEB_URL", optionalEnv("STAGING_WEB_URL", env), {
    allowEmpty: true,
    requireRootPath: true,
  });
  const expectedSignupEnabled = normalizeBoolean(optionalEnv("STAGING_EXPECT_PUBLIC_SIGNUP_ENABLED", env));

  if (stagingWebUrl && stagingBaseUrl.origin === stagingWebUrl.origin) {
    throw new Error("STAGING_BASE_URL and STAGING_WEB_URL resolve to the same origin. API and web staging endpoints must stay distinct.");
  }

  const summary = {
    status: "ok",
    environment: String(env.RAILWAY_ENVIRONMENT_NAME ?? "staging").trim() || "staging",
    projectId: config.projectId,
    apiServiceTargets: config.apiServiceTargets,
    webServiceTargets: config.webServiceTargets,
    stagingBaseUrl: stagingBaseUrl.toString().replace(/\/$/, ""),
    stagingWebUrl: stagingWebUrl ? stagingWebUrl.toString().replace(/\/$/, "") : null,
    expectedPublicSignupEnabled: expectedSignupEnabled,
    checkedAt: new Date().toISOString(),
  };

  console.log(JSON.stringify(summary, null, 2));
}

if (require.main === module) {
  try {
    main(process.env);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = {
  LEGACY_BLOCKED_SERVICE_NAMES,
  assertNoLegacyServiceNames,
  main,
  normalizeBoolean,
  optionalEnv,
  parseUrl,
};
