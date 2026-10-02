#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  const nextConfig = fs.readFileSync(path.join(REPO_ROOT, "apps/web/next.config.ts"), "utf8");

  assert(
    /poweredByHeader:\s*false/.test(nextConfig),
    "next.config.ts must set poweredByHeader: false so responses do not advertise the framework.",
  );
  assert(
    nextConfig.includes('{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }'),
    "next.config.ts must send Strict-Transport-Security with a one-year max-age.",
  );
  assert(
    !/preload/i.test(nextConfig.match(/Strict-Transport-Security[^\n]*/)[0]),
    "HSTS must not carry `preload` (one-way commitment needs a separate CTO decision).",
  );
  assert(
    nextConfig.includes('source: "/(.*)", headers: SECURITY_HEADERS'),
    "Security headers (including HSTS) must apply to every path.",
  );

  console.log("web-security-headers-contract.test.cjs: PASS");
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
