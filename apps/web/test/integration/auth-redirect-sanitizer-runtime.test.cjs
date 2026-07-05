#!/usr/bin/env node
/* eslint-disable no-console */

// Runtime test for sanitizeNextPath — exercises the actual function logic
// by extracting and evaluating the regex guards from the source.

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const AUTH_REDIRECT = path.join(REPO_ROOT, "apps/web/src/lib/auth-redirect.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// Reconstruct sanitizeNextPath from the TypeScript source
function buildSanitizeNextPath() {
  const source = fs.readFileSync(AUTH_REDIRECT, "utf8");
  // Extract the function body between the function signature and closing brace
  const match = source.match(
    /export function sanitizeNextPath\(value:\s*string\):\s*string\s*\{([\s\S]*?)\n\}/,
  );
  if (!match) throw new Error("Could not extract sanitizeNextPath function body");

  // Strip TypeScript type annotations to make it valid JS
  const body = match[1]
    .replace(/:\s*string/g, "")
    .replace(/value\s*\?\?\s*""/g, 'value ?? ""');

  // eslint-disable-next-line no-new-func
  return new Function("value", body);
}

function run() {
  const sanitizeNextPath = buildSanitizeNextPath();

  // Safe paths — should pass through unchanged
  const safePaths = [
    ["/", "/"],
    ["/dashboard", "/dashboard"],
    ["/products/123?tab=quality", "/products/123?tab=quality"],
    ["/quality/approvals", "/quality/approvals"],
    ["/settings/security", "/settings/security"],
    ["/login?reason=session_expired", "/login?reason=session_expired"],
  ];

  for (const [input, expected] of safePaths) {
    const result = sanitizeNextPath(input);
    assert(
      result === expected,
      `Safe path "${input}" should return "${expected}", got "${result}"`,
    );
  }

  // Attack vectors — should all return "/"
  const attacks = [
    ["//evil.com", "Protocol-relative double slash"],
    ["/\\evil.com", "Backslash protocol-relative"],
    ["/%2f/evil.com", "Percent-encoded forward slash lowercase"],
    ["/%2F/evil.com", "Percent-encoded forward slash uppercase"],
    ["/%5c/evil.com", "Percent-encoded backslash lowercase"],
    ["/%5C/evil.com", "Percent-encoded backslash uppercase"],
    ["//evil.com/path", "Double slash with path"],
    ["/\\evil.com/path", "Backslash with path"],
    ["https://evil.com", "Absolute URL"],
    ["javascript:alert(1)", "JavaScript protocol"],
    ["", "Empty string"],
    ["evil.com", "No leading slash"],
    ["  ", "Whitespace only"],
  ];

  for (const [input, description] of attacks) {
    const result = sanitizeNextPath(input);
    assert(
      result === "/",
      `Attack vector "${description}" ("${input}") should return "/", got "${result}"`,
    );
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "safe_paths_pass_through_unchanged",
          "double_slash_blocked",
          "backslash_blocked",
          "percent_encoded_slash_blocked",
          "percent_encoded_backslash_blocked",
          "absolute_url_blocked",
          "javascript_protocol_blocked",
          "empty_string_returns_root",
          "no_leading_slash_returns_root",
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
  console.error("Auth redirect sanitizer runtime test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
