#!/usr/bin/env node
/* eslint-disable no-console */
// PIM#696: source-level blast-radius follow-up to #693 — bulkAssociateMediaCsvAction
// (apps/web/src/app/actions.ts) called postJsonForAction with no error handling at all.
// MediaService.bulkAssociate (apps/api/src/media/media.service.ts) runs a fully sequential,
// no-concurrency per-row loop that does real DB writes and (for imageUrl rows) real outbound
// network fetches, inside one request/response cycle bounded by the same 20s web-tier
// timeout #693 hit. Worse than #693: a timeout here wasn't even caught specially — it
// propagated as an unhandled exception straight to Next's generic error boundary, giving the
// operator no message and no way to know which of up to 5000 CSV rows actually got
// associated. Node.js does not cancel in-flight server-side work just because the client
// stopped waiting, so real MediaAsset rows keep getting written after the client gives up.
//
// This pins the fix: a client-side timeout on this call must never crash silently, and must
// never claim nothing happened — it must point the operator at the Media Assets grid (the one
// place that reflects real server state) before retrying, matching the #693 precedent.
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const ACTIONS_FILE = path.join(REPO_ROOT, "apps", "web", "src", "app", "actions.ts");
const MEDIA_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "media", "page.tsx");
const CORE_API_LIB = path.join(REPO_ROOT, "apps", "web", "src", "lib", "api", "core.ts");
const MEDIA_SERVICE = path.join(REPO_ROOT, "apps", "api", "src", "media", "media.service.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// Extracts the body of `export async function bulkAssociateMediaCsvAction(...) { ... }` —
// tolerant of internal braces (JSX/object literals aren't present here, but nested blocks are).
function extractFunctionBody(source, functionName) {
  const marker = `async function ${functionName}(`;
  const startIndex = source.indexOf(marker);
  assert(startIndex !== -1, `Could not find function "${functionName}" in the source.`);
  const braceStart = source.indexOf("{", startIndex);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(startIndex, i + 1);
    }
  }
  throw new Error(`Could not find closing brace for function "${functionName}".`);
}

// Extracts the JSX body of `{bulkAssociationStatus === "<status>" ? ( ... ) : null}` in
// media/page.tsx, tolerant of nested parens inside the rendered message.
function extractStatusJsxBranch(source, status) {
  const marker = `bulkAssociationStatus === "${status}"`;
  const startIndex = source.indexOf(marker);
  assert(startIndex !== -1, `Could not find a rendered branch for bulkAssociationStatus "${status}".`);
  const parenStart = source.indexOf("(", source.indexOf("?", startIndex));
  let depth = 0;
  for (let i = parenStart; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")") {
      depth--;
      if (depth === 0) return source.slice(startIndex, i + 1);
    }
  }
  throw new Error(`Could not find closing paren for bulkAssociationStatus "${status}" branch.`);
}

function run() {
  const actionsSource = fs.readFileSync(ACTIONS_FILE, "utf8");
  const mediaPageSource = fs.readFileSync(MEDIA_PAGE, "utf8");
  const coreApiSource = fs.readFileSync(CORE_API_LIB, "utf8");
  const mediaServiceSource = fs.readFileSync(MEDIA_SERVICE, "utf8");

  const validated = [];

  // ── 1. The action no longer crashes unhandled on any error ────────────────────────────
  const actionBody = extractFunctionBody(actionsSource, "bulkAssociateMediaCsvAction");
  assert(
    /try\s*{[\s\S]*postJsonForAction[\s\S]*}\s*catch/.test(actionBody),
    "bulkAssociateMediaCsvAction must wrap its postJsonForAction call in try/catch — " +
      "before this fix, any error (including a client timeout) propagated unhandled to Next's generic error boundary.",
  );
  validated.push("action_no_longer_crashes_unhandled");

  // ── 2. Timeout is caught distinctly from other errors, same shape as #693's fix ───────
  assert(
    /error instanceof DOMException && \(error\.name === "TimeoutError" \|\| error\.name === "AbortError"\)/.test(actionBody),
    "bulkAssociateMediaCsvAction must catch DOMException TimeoutError/AbortError distinctly, " +
      "matching the #693 pattern — a fetch timeout never reaches the API as an HTTP response, so it can't be an ApiHttpError.",
  );
  assert(
    /redirect\("\/media\?bulkAssociationStatus=timeout"\)/.test(actionBody),
    'bulkAssociateMediaCsvAction must redirect to /media?bulkAssociationStatus=timeout on a client timeout.',
  );
  validated.push("timeout_caught_distinctly_and_redirects_to_dedicated_status");

  // ── 3. Timeout message must never claim nothing happened ──────────────────────────────
  const timeoutBranch = extractStatusJsxBranch(mediaPageSource, "timeout");
  assert(
    !/nothing (happened|was associated)/i.test(timeoutBranch),
    "The rendered timeout message must never assert nothing happened — MediaService.bulkAssociate keeps writing " +
      "MediaAsset rows server-side after the client's own fetch times out; the client cannot know the real outcome.",
  );
  validated.push("timeout_message_never_claims_nothing_happened");

  // ── 4. Timeout message must point the operator at real server state before retrying ───
  assert(
    /media assets/i.test(timeoutBranch) && /before retrying/i.test(timeoutBranch),
    "The rendered timeout message must direct the operator to check the Media Assets list before retrying, " +
      "not just invite an unconditional resubmit (which could create duplicate assets for already-associated rows).",
  );
  validated.push("timeout_directs_to_media_assets_before_retry");

  // ── 5. A generic (non-timeout) error is also caught, not just the timeout case ────────
  assert(
    /redirect\("\/media\?bulkAssociationStatus=error"\)/.test(actionBody),
    'bulkAssociateMediaCsvAction must also redirect to /media?bulkAssociationStatus=error for non-timeout failures ' +
      '(e.g. malformed CSV, validation errors) — the fix is not scoped to timeouts alone.',
  );
  const errorBranch = extractStatusJsxBranch(mediaPageSource, "error");
  assert(errorBranch.length > 0, "media/page.tsx must render a message for bulkAssociationStatus=error.");
  validated.push("generic_error_also_caught_and_rendered");

  // ── 6. Redirect/session-expiry plumbing is reused, not reinvented ──────────────────────
  assert(
    /rethrowRedirectError\(error\)/.test(actionBody) && /handleSessionExpired\(error,\s*"\/media"\)/.test(actionBody),
    "bulkAssociateMediaCsvAction must reuse rethrowRedirectError/handleSessionExpired like every other action in this " +
      "file, not reimplement redirect-detection or session-expiry handling locally.",
  );
  validated.push("reuses_shared_redirect_and_session_expiry_helpers");

  // ── 7. Fix stays scoped to the action/message layer — no shared-layer or API-side changes ──
  assert(
    coreApiSource.includes("const FETCH_TIMEOUT_MS = 20_000;"),
    "This fix must not change the shared FETCH_TIMEOUT_MS default — out of scope, same as #693.",
  );
  assert(
    !coreApiSource.includes("bulk-association") && !coreApiSource.includes("bulkAssociat"),
    "The shared fetch/core API layer must stay unaware of bulk-media-association specifics — this fix belongs " +
      "entirely in the action/message layer.",
  );
  // #696 was filed as root-caused-from-source only, not live-reproduced — confirm the actual
  // defect (fully sequential loop, no concurrency control) is still present in the API service.
  // This fix (client-side timeout handling) is deliberately NOT the full async-worker rewrite
  // the issue's step 3 describes; that remains open. Fail loudly if the loop shape changes
  // without this test being revisited, rather than silently going stale.
  assert(
    mediaServiceSource.includes("for (let index = 0; index < rows.length; index += 1)"),
    "MediaService.bulkAssociate's per-row loop shape changed — re-check whether #696's root cause (fully sequential, " +
      "no concurrency, real network fetch per row) still applies, and whether this client-side-only fix is still sufficient.",
  );
  validated.push("fix_scoped_to_action_layer_api_side_defect_still_open");

  console.log(
    JSON.stringify(
      {
        status: "ok",
        suite: "bulk-media-association-timeout-ambiguous-outcome",
        validated,
        note: "Client-side timeout handling only (PIM#696 step 2). The underlying sequential/no-concurrency API loop (step 3, async-worker rewrite) remains open.",
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
  console.error("Bulk media association timeout ambiguous-outcome test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
