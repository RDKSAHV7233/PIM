#!/usr/bin/env node
/* eslint-disable no-console */
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const TS_NODE_REGISTER = "/mnt/c/Users/bhoiv/PIM1/node_modules/ts-node/register/transpile-only";
const ROOT_NODE_MODULES = "/mnt/c/Users/bhoiv/PIM1/node_modules";
const RELEASE = "260a89cc3475152d27821ae2334389ae88084f67";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function baseEnv(overrides = {}) {
  return {
    ...process.env,
    NODE_PATH: ROOT_NODE_MODULES,
    TS_NODE_COMPILER_OPTIONS: '{ "module": "CommonJS", "moduleResolution": "Node" }',
    DATABASE_URL_POOLED: "postgresql://vexa:vexa@localhost:5432/vexa",
    DATABASE_URL_DIRECT: "postgresql://vexa:vexa@localhost:5432/vexa",
    JWT_SECRET: "vexa-pim-local-dev-jwt-secret-minimum-length-32",
    CREDENTIAL_ENCRYPTION_KEY_V1: "vexa-pim-local-encryption-key-v1-minimum-32",
    CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION: "1",
    REDIS_URL: "redis://localhost:6379",
    R2_ACCOUNT_ID: "local-dev",
    R2_ACCESS_KEY_ID: "local-dev",
    R2_SECRET_ACCESS_KEY: "local-dev",
    R2_BUCKET_NAME: "vexa-pim-local",
    R2_PUBLIC_URL: "https://example.com/vexa-pim-local",
    FEATURE_REAL_SPAPI_VALIDATION: "false",
    FEATURE_PUBLIC_SIGNUP_ENABLED: "false",
    FEATURE_ONDC_ENABLED: "false",
    FEATURE_STRIPE_BILLING_ENABLED: "false",
    ...overrides,
  };
}

function strictErrorAuthorityEnv(overrides = {}) {
  return baseEnv({
    APP_ENV: "staging",
    AUTH_MODE: "db",
    CORS_ORIGIN: "https://staging.example.com",
    AUTH_EMAIL_PROVIDER: "console",
    QUEUE_BACKEND: "bullmq",
    QUEUE_WORKER_ENABLED: "true",
    PIM_AUTH_IDENTITIES_JSON: "",
    PIM_COMMERCIAL_CONTACT_URL: "https://example.com/contact-sales",
    PIM_COMMERCIAL_OPS_TOKEN: "staging-commercial-ops-token",
    PIM_AUTH_REDIS_DISABLED: "false",
    JWT_BLOCKLIST_REDIS_DISABLED: "false",
    ERROR_AUTHORITY_ENABLED: "true",
    OBSERVABILITY_DATABASE_URL: "postgresql://vexa:vexa@localhost:5432/vexa_observability",
    ERROR_AUTHORITY_REF_SECRET: "error-authority-ref-secret-minimum-length-32",
    ERROR_AUTHORITY_RELEASE: RELEASE,
    ERROR_AUTHORITY_INGEST_TOKEN: "error-authority-ingest-token-minimum-32",
    ...overrides,
  });
}

function runNode(script, env) {
  return spawnSync("node", ["-r", TS_NODE_REGISTER, "-e", script], {
    cwd: REPO_ROOT,
    env,
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
}

function validateEnvCase(env) {
  return runNode(
    `
process.exit = (code) => { throw new Error("PROCESS_EXIT_" + code); };
const { validateEnv } = require("./apps/api/src/common/env-validation.ts");
try {
  validateEnv();
  console.log("VALIDATION_PASSED");
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
    `.trim(),
    env,
  );
}

function expectValidationFailure(name, env, expectedOutput) {
  const result = validateEnvCase(env);
  const output = `${result.stdout}\n${result.stderr}`;
  assert(result.status !== 0, `${name}: expected failure, got status 0`);
  assert(output.includes(expectedOutput), `${name}: expected output to include ${expectedOutput}. Output tail: ${output.slice(-1000)}`);
}

function expectValidationSuccess(name, env) {
  const result = validateEnvCase(env);
  const output = `${result.stdout}\n${result.stderr}`;
  assert(result.status === 0, `${name}: expected success, got ${result.status}. Output tail: ${output.slice(-1000)}`);
  assert(output.includes("VALIDATION_PASSED"), `${name}: expected validation pass marker. Output tail: ${output.slice(-1000)}`);
}

function runReleaseAccessorProof() {
  const result = runNode(
    `
const { resolveErrorAuthorityRelease, ERROR_AUTHORITY_LOCAL_RELEASE } = require("./apps/api/src/common/error-authority-env.ts");
if (resolveErrorAuthorityRelease({ APP_ENV: "development", ERROR_AUTHORITY_ENABLED: "true" }) !== ERROR_AUTHORITY_LOCAL_RELEASE) {
  throw new Error("development fallback did not use canonical local release");
}
if (resolveErrorAuthorityRelease({ APP_ENV: "staging", ERROR_AUTHORITY_ENABLED: "true", ERROR_AUTHORITY_RELEASE: "${RELEASE}" }) !== "${RELEASE}") {
  throw new Error("explicit release did not resolve deterministically");
}
console.log("RELEASE_ACCESSOR_PASSED");
    `.trim(),
    baseEnv(),
  );
  const output = `${result.stdout}\n${result.stderr}`;
  assert(result.status === 0, `release accessor proof failed. Output tail: ${output.slice(-1000)}`);
  assert(output.includes("RELEASE_ACCESSOR_PASSED"), `release accessor proof marker missing. Output tail: ${output.slice(-1000)}`);
}

try {
  expectValidationFailure(
    "staging enabled missing release",
    strictErrorAuthorityEnv({ ERROR_AUTHORITY_RELEASE: "" }),
    "ERROR_AUTHORITY_RELEASE",
  );
  expectValidationFailure(
    "staging enabled malformed release",
    strictErrorAuthorityEnv({ ERROR_AUTHORITY_RELEASE: "latest" }),
    "deploy-specific immutable release",
  );
  expectValidationFailure(
    "staging enabled missing ingest token",
    strictErrorAuthorityEnv({ ERROR_AUTHORITY_INGEST_TOKEN: "" }),
    "ERROR_AUTHORITY_INGEST_TOKEN",
  );
  expectValidationSuccess("staging enabled valid release and ingest token", strictErrorAuthorityEnv());
  expectValidationSuccess(
    "development enabled local fallback",
    baseEnv({
      APP_ENV: "development",
      AUTH_MODE: "local",
      QUEUE_BACKEND: "memory",
      QUEUE_WORKER_ENABLED: "true",
      ERROR_AUTHORITY_ENABLED: "true",
      OBSERVABILITY_DATABASE_URL: "postgresql://vexa:vexa@localhost:5432/vexa_observability",
      ERROR_AUTHORITY_REF_SECRET: "error-authority-ref-secret-minimum-length-32",
      ERROR_AUTHORITY_RELEASE: "",
      ERROR_AUTHORITY_INGEST_TOKEN: "",
    }),
  );
  runReleaseAccessorProof();

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "staging_error_authority_requires_release",
          "staging_error_authority_rejects_malformed_release",
          "staging_error_authority_requires_ingest_token",
          "staging_error_authority_accepts_release_and_token",
          "development_error_authority_uses_local_release_fallback",
          "canonical_release_accessor_is_deterministic",
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error("Error Authority source env runtime test failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
