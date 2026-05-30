#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const INSTRUMENTATION_FILE = path.join(REPO_ROOT, "apps", "web", "src", "instrumentation.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(INSTRUMENTATION_FILE, "utf8");

  assert(
    source.includes("export async function register()") &&
      source.includes('process.env.NEXT_RUNTIME !== "nodejs"'),
    "Instrumentation must export register() and guard against non-Node runtimes.",
  );
  assert(
    source.includes('JWT_SECRET') &&
      source.includes('PIM_JWT_SECRET') &&
      source.includes('sessions cannot be verified'),
    "Env gate must check for JWT_SECRET and block startup when missing in strict environments.",
  );
  assert(
    source.includes('PIM_API_BASE_URL') &&
      source.includes('NEXT_PUBLIC_API_URL') &&
      source.includes('localhost:4000'),
    "Env gate must check for PIM_API_BASE_URL and warn about localhost fallback.",
  );
  assert(
    source.includes('AUTH_MODE') &&
      source.includes('"db"') &&
      source.includes('isStrictEnv'),
    "Env gate must enforce AUTH_MODE=db in staging/production.",
  );
  assert(
    source.includes('STARTUP BLOCKED') &&
      source.includes('throw new Error'),
    "Env gate must throw (blocking startup) when required vars are missing in strict env.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "env_gate_guards_non_node_runtimes",
          "env_gate_blocks_on_missing_jwt_secret",
          "env_gate_warns_on_missing_api_base_url",
          "env_gate_enforces_db_auth_mode_in_strict_env",
          "env_gate_throws_to_block_startup",
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
  console.error("Env gate test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
