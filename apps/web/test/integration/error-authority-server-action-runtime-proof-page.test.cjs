#!/usr/bin/env node
/* eslint-disable no-console */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const PAGE_PATH = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "app",
  "internal",
  "error-authority",
  "runtime-proof",
  "server-action",
  "page.tsx",
);
const MIDDLEWARE_PATH = path.join(REPO_ROOT, "apps", "web", "src", "middleware.ts");

function main() {
  const source = fs.readFileSync(PAGE_PATH, "utf8");
  const middleware = fs.readFileSync(MIDDLEWARE_PATH, "utf8");

  assert.match(source, /export const runtime = "nodejs"/, "Server Action proof must execute in the Node.js runtime.");
  assert.match(source, /export const dynamic = "force-dynamic"/, "Server Action proof must not be statically optimized.");
  assert.match(source, /"use server"/, "Server Action proof must throw from an actual Server Action.");
  assert.match(source, /appEnv !== "staging"/, "Server Action proof must be unavailable outside staging.");
  assert.match(
    source,
    /ERROR_AUTHORITY_RUNTIME_PROOF_TOKEN/,
    "Server Action proof must require a dedicated server-side proof token.",
  );
  assert.doesNotMatch(
    source,
    /ERROR_AUTHORITY_INGEST_TOKEN/,
    "Server Action proof must not reuse the trusted ingest token as the public proof trigger secret.",
  );
  assert.match(source, /timingSafeEqual/, "Server Action proof token comparison must use timing-safe comparison.");
  assert.match(source, /notFound\(\)/, "Unavailable or unauthorized proof action must hide as not found.");
  assert.match(
    source,
    /throw PROOF_ERROR/,
    "Server Action proof must throw through Next.js Server Action handling so instrumentation.onRequestError owns capture.",
  );
  assert.match(
    source,
    /ERR_04B_NEXT_SERVER_ACTION_RUNTIME_PROOF/,
    "Server Action proof error must be identifiable without including secrets or user payload.",
  );
  assert.match(
    middleware,
    /pathname\.startsWith\(`\$\{ERROR_AUTHORITY_RUNTIME_PROOF_PATH\}\/`\)/,
    "Middleware must let nested runtime proof pages reach their own proof-token gates before auth redirect.",
  );

  console.log("error-authority-server-action-runtime-proof-page.test.cjs: PASS");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
