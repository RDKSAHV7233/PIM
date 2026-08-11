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
  "page.tsx",
);

function main() {
  const source = fs.readFileSync(PAGE_PATH, "utf8");

  assert.match(source, /export const runtime = "nodejs"/, "Render proof page must execute in the Node.js runtime.");
  assert.match(source, /export const dynamic = "force-dynamic"/, "Render proof page must not be statically optimized.");
  assert.match(source, /headers\(\)/, "Render proof page must read the proof token from a request header.");
  assert.match(source, /appEnv !== "staging"/, "Render proof page must be unavailable outside staging.");
  assert.match(
    source,
    /ERROR_AUTHORITY_RUNTIME_PROOF_TOKEN/,
    "Render proof page must require a dedicated server-side proof token.",
  );
  assert.doesNotMatch(
    source,
    /ERROR_AUTHORITY_INGEST_TOKEN/,
    "Render proof page must not reuse the trusted ingest token as the public proof trigger secret.",
  );
  assert.match(source, /timingSafeEqual/, "Render proof token comparison must use timing-safe comparison.");
  assert.match(source, /notFound\(\)/, "Unavailable or unauthorized proof page must hide as not found.");
  assert.match(
    source,
    /throw PROOF_ERROR/,
    "Render proof page must throw through Next.js server rendering so instrumentation.onRequestError owns capture.",
  );
  assert.match(
    source,
    /ERR_04B_NEXT_SERVER_RENDER_RUNTIME_PROOF/,
    "Render proof error must be identifiable without including secrets or user payload.",
  );

  console.log("error-authority-render-runtime-proof-page.test.cjs: PASS");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
