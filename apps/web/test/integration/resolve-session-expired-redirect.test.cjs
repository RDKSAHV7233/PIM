#!/usr/bin/env node
/* eslint-disable no-console */
// BUG-AUTH-STALE-SESSION-001 (A0): resolveSessionExpiredRedirect() is the pure
// classification layer for a mutation server action's session-expiry 401.
// It deliberately mirrors withPlanLimitQuery's exact contract: synchronous,
// no side effects, never calls redirect() itself, returns a path or null.
// The calling action (A1, not yet wired) decides whether to redirect.
//
// This must:
//   - recognize only ApiHttpError with status === 401
//   - delegate URL construction to the existing buildLoginRedirect (already
//     does next-path sanitization; not re-implemented here)
//   - return null for 402/403/500/plain errors, so it never interferes with
//     withPlanLimitQuery, the ad-hoc 403 handling, or a genuine backend 500
//   - return null for anything that is not an ApiHttpError instance at all,
//     so a NEXT_REDIRECT control-flow signal (not an ApiHttpError) passes
//     through untouched and the existing rethrowRedirectError convention
//     remains the sole authority over redirect-signal propagation
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const ACTIONS_FILE = path.join(REPO_ROOT, "apps", "web", "src", "app", "actions.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function extractFunctionBody(source, functionSignature, fileLabel) {
  const startIndex = source.indexOf(functionSignature);
  assert(startIndex !== -1, `${fileLabel}: could not locate "${functionSignature}"`);
  const braceStart = source.indexOf("{", startIndex);
  assert(braceStart !== -1, `${fileLabel}: could not locate opening brace for "${functionSignature}"`);
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIndex, i + 1);
      }
    }
  }
  throw new Error(`${fileLabel}: unterminated function body for "${functionSignature}"`);
}

function run() {
  const source = fs.readFileSync(ACTIONS_FILE, "utf8");

  // The helper must be imported from the existing, already-safe auth-redirect
  // module, not re-implemented locally (next-path sanitization already lives
  // there and must not be duplicated/drifted).
  assert(
    /import\s*\{\s*buildLoginRedirect\s*\}\s*from\s*"@\/lib\/auth-redirect";/.test(source),
    "actions.ts must import buildLoginRedirect from @/lib/auth-redirect rather than re-implementing login-redirect construction.",
  );

  const fnBody = extractFunctionBody(
    source,
    "function resolveSessionExpiredRedirect(",
    "actions.ts",
  );

  // Pure contract: mirrors withPlanLimitQuery exactly. No redirect() call
  // inside itself - that decision belongs to the calling action.
  assert(
    !/\bredirect\(/.test(fnBody),
    "resolveSessionExpiredRedirect must never call redirect() itself - it is a pure classifier, matching withPlanLimitQuery's existing contract. The calling action must decide whether to redirect.",
  );

  // Must gate strictly on ApiHttpError + status 401 - not a generic
  // "any auth-shaped error" heuristic, and not scoped to 403/402/500.
  assert(
    /error instanceof ApiHttpError/.test(fnBody) && /error\.status\s*!==\s*401/.test(fnBody),
    'resolveSessionExpiredRedirect must gate on "error instanceof ApiHttpError" and "error.status !== 401" so it never fires for 402/403/500/plain errors, and never fires for a non-ApiHttpError value such as a NEXT_REDIRECT control-flow signal.',
  );
  assert(
    /return null;/.test(fnBody),
    "resolveSessionExpiredRedirect must return null for anything that isn't a 401 ApiHttpError.",
  );

  // Must delegate URL construction, not build /login?... by hand.
  assert(
    /return buildLoginRedirect\(/.test(fnBody),
    "resolveSessionExpiredRedirect must delegate to buildLoginRedirect for the redirect path, reusing its existing next-path sanitization rather than constructing a URL locally.",
  );

  // Regression guard: withPlanLimitQuery (the pattern being mirrored) must
  // still exist unchanged and still be the pure, no-redirect() shape it was
  // before this change - this test only adds a sibling, it doesn't touch it.
  const planLimitBody = extractFunctionBody(
    source,
    "function withPlanLimitQuery(basePath: string, error: unknown): string | null {",
    "actions.ts",
  );
  assert(
    !/\bredirect\(/.test(planLimitBody),
    "withPlanLimitQuery must remain unchanged: no redirect() call inside itself.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "resolve_session_expired_redirect_imports_build_login_redirect",
          "resolve_session_expired_redirect_never_calls_redirect_itself",
          "resolve_session_expired_redirect_gates_on_api_http_error_401_only",
          "resolve_session_expired_redirect_returns_null_for_non_401",
          "resolve_session_expired_redirect_delegates_url_construction",
          "with_plan_limit_query_unchanged_and_still_pure",
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
  console.error("BUG-AUTH-STALE-SESSION-001 (A0) resolveSessionExpiredRedirect contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
