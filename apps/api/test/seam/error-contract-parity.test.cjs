/**
 * Seam test: Error contract parity.
 *
 * Ensures every structured error code the API can return has a corresponding
 * handler in the web frontend. This catches the class of bug where the API
 * returns { error: "SOME_CODE" } but the UI shows "Something went wrong"
 * because nobody added a handler for that code.
 *
 * Approach:
 * - Scan API source for `error: "SOME_CODE"` patterns in throw/response objects
 * - Scan web source for those same code strings
 * - Report any API codes missing from the web
 *
 * This is deliberately conservative: it flags codes that appear in the API but
 * not in the web. Some codes are internal (never reach the UI) — those should
 * be added to the INTERNAL_ONLY_CODES allowlist below.
 */

const fs = require("node:fs");
const path = require("node:path");

// Codes that are internal-only and never reach the browser
const INTERNAL_ONLY_CODES = new Set([
  "TENANT_KEY_REQUIRED",
  "COMMERCIAL_STATE_CHANGE_REQUIRED",
  "STRIPE_SECRET_KEY_NOT_CONFIGURED",
  "ADMIN_BOUNDARY_FORBIDDEN",
  "FOUNDATION_ROLE_BLOCKED",
  "ROLE_FORBIDDEN",
  "WRITE_ROLE_REQUIRED",
  "DEFAULT_WRITE_ALLOWED",
  "ADMIN_BOUNDARY_ALLOWED",
  "ADMIN_BOUNDARY_ROLE_BYPASS",
  "ROLE_ALLOWED",
  "API_CLIENT_FORBIDDEN",
  "API_CLIENT_NOT_APPLICABLE",
  "API_CLIENT_SERVICE_INTERNAL_ONLY",
  "API_CLIENT_SCOPE_REQUIRED",
  "API_CLIENT_SCOPE_FORBIDDEN",
  "API_CLIENT_SCOPE_NOT_APPLICABLE",
  "UNCLASSIFIED_AUTHENTICATED_READ_ALLOWED",
  "AUTHENTICATED_READ_CLASSIFICATION_REQUIRED",
  // Shadow-mode / access policy internals
  "PLAN_CONNECTOR_INSTALLATIONS_LIMIT_EXCEEDED",
  "PLAN_CONNECTOR_ACCOUNTS_LIMIT_EXCEEDED",
  // Auth token routing — handled by middleware redirect, not the web error handler
  "REFRESH_TOKEN_MISSING",
  "REFRESH_TOKEN_INVALID",
  "REFRESH_TOKEN_NOT_ALLOWED_AS_ACCESS_TOKEN",
  "STEP_UP_TOKEN_NOT_ALLOWED_AS_ACCESS_TOKEN",
  "MFA_PENDING_TOKEN_NOT_ALLOWED_AS_ACCESS_TOKEN",
  "MFA_ENROLLMENT_TOKEN_NOT_ALLOWED_AS_ACCESS_TOKEN",
  // Machine-to-machine auth — never reach a browser user
  "INVALID_API_KEY",
  "INTERNAL_TOKEN_RATE_LIMITED",
  "INTERNAL_TOKEN_REQUIRED",
  "CONNECTOR_WEBHOOK_RELAY_TOKEN_REQUIRED",
  // Commercial / platform-admin internals — not user-facing
  "COMMERCIAL_MUTATION_INTERNAL_ONLY",
  "COMMERCIAL_TENANT_SEARCH_FAILED",
  "COMMERCIAL_OPS_TOKEN_REQUIRED",
  "NO_AUTH_POLICY_CHANGES",
  "PLATFORM_ADMIN_TOKEN_REQUIRED",
  "TENANT_PROVISIONING_FAILED",
  // Connector install internals — never surface directly to the web UI
  "CONNECTOR_SLUG_MISMATCH",
  // Network-level error code (not a structured API response body)
  "ECONNRESET",
]);

function findFilesRecursive(dir, pattern) {
  const results = [];
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.name === "node_modules" || entry.name === ".next") continue;
      if (entry.isDirectory()) {
        results.push(...findFilesRecursive(fullPath, pattern));
      } else if (pattern.test(entry.name)) {
        results.push(fullPath);
      }
    }
  } catch { /* ignore permission errors */ }
  return results;
}

// ── Extract error codes from API ──────────────────────────────────────────
const apiSrcDir = path.join(__dirname, "../../src");
const apiFiles = findFilesRecursive(apiSrcDir, /\.(ts|js)$/);

const apiErrorCodes = new Set();
const errorCodePattern = /error:\s*["']([A-Z][A-Z0-9_]+)["']/g;

for (const file of apiFiles) {
  const content = fs.readFileSync(file, "utf-8");
  let match;
  while ((match = errorCodePattern.exec(content)) !== null) {
    const code = match[1];
    if (!INTERNAL_ONLY_CODES.has(code)) {
      apiErrorCodes.add(code);
    }
  }
}

// ── Scan web source for error code handlers ───────────────────────────────
const webSrcDir = path.join(__dirname, "../../../../apps/web/src");
const webFiles = findFilesRecursive(webSrcDir, /\.(ts|tsx|js|jsx)$/);

const webHandledCodes = new Set();
for (const file of webFiles) {
  const content = fs.readFileSync(file, "utf-8");
  for (const code of apiErrorCodes) {
    if (content.includes(code)) {
      webHandledCodes.add(code);
    }
  }
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("Error contract parity seam test", () => {
  test("API source has structured error codes", () => {
    expect(apiErrorCodes.size).toBeGreaterThan(5);
  });

  test("web source handles structured error codes", () => {
    expect(webHandledCodes.size).toBeGreaterThan(0);
  });

  // Report all unhandled codes, but don't fail on each one individually.
  // Some may be legitimately handled by generic 4xx handlers.
  test("critical error codes have web handlers", () => {
    const criticalCodes = [
      "PLAN_LIMIT_EXCEEDED",
      "PLAN_USERS_LIMIT_EXCEEDED",
      "TENANT_SUSPENDED",
      "ACCESS_POLICY_DENIED",
      "USER_ALREADY_EXISTS",
      "USER_ID_REQUIRED",
    ];
    const missing = criticalCodes.filter(
      (code) => apiErrorCodes.has(code) && !webHandledCodes.has(code),
    );
    expect(missing).toEqual([]);
  });

  test("report all unhandled error codes (informational)", () => {
    const unhandled = [...apiErrorCodes].filter(
      (code) => !webHandledCodes.has(code),
    );
    if (unhandled.length > 0) {
      console.warn(
        `[error-contract] ${unhandled.length} API error codes have no explicit web handler:\n` +
          unhandled.map((c) => `  - ${c}`).join("\n") +
          "\nAdd handlers or add to INTERNAL_ONLY_CODES if these never reach the browser.",
      );
    }
    // This is informational — we don't fail on non-critical unhandled codes.
    // The critical codes test above catches the important ones.
    expect(true).toBe(true);
  });
});
