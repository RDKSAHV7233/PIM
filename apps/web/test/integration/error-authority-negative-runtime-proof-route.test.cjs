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
  "negative-proof",
  "route.ts",
);

function main() {
  const source = fs.readFileSync(ROUTE_PATH, "utf8");

  assert.match(source, /export const runtime = "nodejs"/, "Negative proof route must execute in the Node.js runtime.");
  assert.match(source, /export const dynamic = "force-dynamic"/, "Negative proof route must not be statically optimized.");
  assert.match(source, /export async function POST\(/, "Negative proof route must be POST-only.");
  assert.doesNotMatch(source, /export async function GET\(/, "Negative proof route must not expose a GET trigger.");
  assert.match(source, /appEnv !== "staging"/, "Negative proof route must be unavailable outside staging.");
  assert.match(
    source,
    /ERROR_AUTHORITY_RUNTIME_PROOF_TOKEN/,
    "Negative proof route must require the dedicated runtime proof token.",
  );
  assert.doesNotMatch(
    source,
    /process\.env\.ERROR_AUTHORITY_INGEST_TOKEN/,
    "Negative proof route must not read or return the trusted ingest token.",
  );
  assert.match(source, /timingSafeEqual/, "Negative proof token comparison must use timing-safe comparison.");
  assert.match(source, /return notFoundResponse\(\)/, "Unavailable or unauthorized negative proof route must hide as not found.");
  assert.match(
    source,
    /verifyTrustedIngestRejectsMissingOrInvalidToken/,
    "Negative proof route must verify trusted ingest rejects no-token and wrong-token calls.",
  );
  assert.match(
    source,
    /verifyCaptureTransportFailureDoesNotThrow/,
    "Negative proof route must verify capture transport failures fail open.",
  );
  assert.match(
    source,
    /globalThis\.fetch = async \(\) => \{/,
    "Fail-open proof must force capture transport failure without changing staging service configuration.",
  );
  assert.match(
    source,
    /globalThis\.fetch = originalFetch/,
    "Fail-open proof must restore global fetch after the bounded proof call.",
  );
  assert.match(
    source,
    /NEGATIVE_PROOF_SHOULD_NOT_STORE/,
    "Auth-negative proof must use an identifiable no-store event code.",
  );

  console.log("error-authority-negative-runtime-proof-route.test.cjs: PASS");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
