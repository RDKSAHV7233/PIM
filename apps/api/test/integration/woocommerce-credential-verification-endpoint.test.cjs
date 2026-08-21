#!/usr/bin/env node
/* eslint-disable no-console */
//
// Regression test for PIM#582: WooCommerce's credential verification (validateCredentials
// and verifyCandidateCredentials) both called `callApi('GET', '', ...)` — the bare
// /wp-json/wc/v3 root. That root is WordPress's public route-discovery endpoint: it
// returns 200 with the full route table even with NO Authorization header at all.
//
// Live-verified against a real connected WooCommerce store (2026-08-21):
//   GET /wp-json/wc/v3            with garbage consumer_key/consumer_secret → 200 OK
//   GET /wp-json/wc/v3            with NO auth header at all                → 200 OK (identical body)
//   GET /wp-json/wc/v3/products   with garbage consumer_key/consumer_secret → 401 Unauthorized
//
// So the credential check could never actually detect wrong credentials — any
// consumer_key/consumer_secret combination, including empty strings, would classify as
// "valid" as long as the site itself was reachable. This test asserts both call sites hit
// a real, auth-required resource (a WooCommerce REST API root call alone is never enough),
// and that no call site regresses back to the unauthenticated bare root.
//
// This is a source-level check, not a live-network test — this repo doesn't run live
// WooCommerce network calls in CI (see the file's own comments: "Docker WooCommerce CI
// fixture required"). The actual fix was live-verified manually against a real store
// before landing; see the PR description for the exact before/after HTTP responses.
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const CONNECTOR_FILE = path.join(REPO_ROOT, "apps", "api", "src", "connectors", "woocommerce", "woocommerce.connector.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(CONNECTOR_FILE, "utf8");

  assert(
    !/callApi\('GET',\s*''/.test(source),
    "PIM#582: no call site may hit the bare /wp-json/wc/v3 root for credential verification — " +
      "it's WordPress's public route-discovery endpoint and returns 200 even with no auth header " +
      "at all, so it can never distinguish valid credentials from wrong ones.",
  );

  const protectedEndpointCallCount = (source.match(/callApi\('GET', '\/products\?per_page=1'/g) ?? []).length;
  assert(
    protectedEndpointCallCount === 2,
    `PIM#582: expected exactly 2 call sites hitting the real, auth-required /products?per_page=1 ` +
      `resource (validateCredentials and verifyCandidateCredentials) — found ${protectedEndpointCallCount}. ` +
      "Both credential-verification paths must hit a real protected resource, not just confirm the " +
      "site is reachable.",
  );

  assert(
    source.includes("async validateCredentials(") && source.includes("async verifyCandidateCredentials("),
    "PIM#582: expected both validateCredentials and verifyCandidateCredentials to still be defined — " +
      "this test's line-count assertions assume exactly these two call sites exist.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "no_call_site_uses_unauthenticated_bare_root",
          "both_verification_paths_hit_real_protected_resource",
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
  console.error("WooCommerce credential verification endpoint test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
