#!/usr/bin/env node
/* eslint-disable no-console */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const ROUTE_PATH = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "app",
  "api",
  "internal",
  "error-authority",
  "runtime-proof",
  "route.ts",
);

function main() {
  const source = fs.readFileSync(ROUTE_PATH, "utf8");

  assert.match(source, /export const runtime = "nodejs"/, "Runtime proof route must execute in the Node.js runtime.");
  assert.match(source, /export const dynamic = "force-dynamic"/, "Runtime proof route must not be statically optimized.");
  assert.match(source, /export async function POST\(/, "Runtime proof route must be POST-only.");
  assert.doesNotMatch(source, /export async function GET\(/, "Runtime proof route must not expose a GET trigger.");
  assert.match(source, /appEnv !== "staging"/, "Runtime proof route must be unavailable outside staging.");
  assert.match(
    source,
    /ERROR_AUTHORITY_RUNTIME_PROOF_TOKEN/,
    "Runtime proof route must require a dedicated server-side proof token.",
  );
  assert.doesNotMatch(
    source,
    /ERROR_AUTHORITY_INGEST_TOKEN/,
    "Runtime proof route must not reuse the trusted ingest token as the public proof trigger secret.",
  );
  assert.match(source, /timingSafeEqual/, "Runtime proof token comparison must use timing-safe comparison.");
  assert.match(source, /return notFoundResponse\(\)/, "Unavailable or unauthorized proof route must hide as not found.");
  assert.match(
    source,
    /throw PROOF_ERROR/,
    "Runtime proof route must throw through Next.js route handling so instrumentation.onRequestError owns capture.",
  );
  assert.match(
    source,
    /ERR_04B_NEXT_SERVER_RUNTIME_PROOF/,
    "Runtime proof error must be identifiable without including secrets or user payload.",
  );

  console.log("error-authority-runtime-proof-route.test.cjs: PASS");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
