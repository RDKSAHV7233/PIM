#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const AUTH_REDIRECT = path.join(REPO_ROOT, "apps/web/src/lib/auth-redirect.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(AUTH_REDIRECT, "utf8");

  assert(
    source.includes('if (!trimmed.startsWith("/"))') &&
      source.includes('return "/"'),
    "sanitizeNextPath must reject values that do not start with a forward slash.",
  );

  assert(
    source.includes('/^\\/[/\\\\]/.test(trimmed)'),
    "sanitizeNextPath must block protocol-relative URLs via both // and /\\ patterns.",
  );

  assert(
    source.includes('/^\\/%(?:2[fF]|5[cC])/.test(trimmed)'),
    "sanitizeNextPath must block percent-encoded slash (%2f/%2F) and backslash (%5c/%5C) in the second character.",
  );

  assert(
    source.includes("sanitizeNextPath") &&
      source.includes("buildLoginRedirect") &&
      source.includes("sanitizeNextPath(nextPath)"),
    "buildLoginRedirect must pass nextPath through sanitizeNextPath before embedding it in the redirect URL.",
  );

  // Verify the function correctly handles all known bypass vectors by checking
  // the source implements the full guard chain: non-slash prefix → // → /\ → %2f → %5c
  const guardCount = (source.match(/return\s+"\/"/g) || []).length;
  assert(
    guardCount >= 3,
    `sanitizeNextPath must have at least 3 guard return-to-root paths (non-slash, protocol-relative, percent-encoded). Found ${guardCount}.`,
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "sanitizeNextPath_rejects_non_slash_prefix",
          "sanitizeNextPath_blocks_protocol_relative_slash_and_backslash",
          "sanitizeNextPath_blocks_percent_encoded_slash_and_backslash",
          "buildLoginRedirect_uses_sanitizeNextPath",
          "sanitizeNextPath_has_complete_guard_chain",
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
  console.error("Auth redirect sanitizer contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
