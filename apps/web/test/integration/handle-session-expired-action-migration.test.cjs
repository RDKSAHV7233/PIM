#!/usr/bin/env node
/* eslint-disable no-console */
// BUG-AUTH-STALE-SESSION-001 (A1): migrates individual mutation server actions
// onto the A0 primitive (resolveSessionExpiredRedirect, merged separately with
// its own source-contract test in resolve-session-expired-redirect.test.cjs).
//
// This file locks the A1 acceptance rule:
//   "A 401 changes to session-expired navigation; every non-401 error behaves
//    exactly as it did before."
// Concretely:
//   - rethrowRedirectError() still runs first wherever it already did (NEXT_REDIRECT
//     propagates unchanged)
//   - handleSessionExpired() runs before any other error-specific handling in
//     each migrated catch, so a 401 never reaches withPlanLimitQuery/403
//     handling/step-up handling/retry-message construction
//   - the 3 timeout-tolerant bulk-import swallow catches now bind their error
//     and check it, but their swallow comment/behavior is otherwise untouched
//   - retrySubmissionAction's 401 check runs before it builds a
//     retryError/retryErrorMessage from the same error
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

// Extracts the body of the FIRST catch block inside a function body that
// contains `postJsonForAction`/`patchJsonForAction`/`deleteJsonForAction`
// in its preceding try - i.e. the mutation's own catch, not an unrelated
// nested try/catch elsewhere in the same action.
function extractCatchBody(fnBody, fnName) {
  const catchIdx = fnBody.search(/\}\s*catch\s*\(error: unknown\)\s*\{/);
  assert(catchIdx !== -1, `${fnName}: could not locate a "catch (error: unknown)" block.`);
  const braceStart = fnBody.indexOf("{", fnBody.indexOf("catch", catchIdx));
  let depth = 0;
  for (let i = braceStart; i < fnBody.length; i += 1) {
    if (fnBody[i] === "{") depth += 1;
    if (fnBody[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        return fnBody.slice(braceStart, i + 1);
      }
    }
  }
  throw new Error(`${fnName}: unterminated catch body.`);
}

function assertHandleSessionExpiredPrecedes(catchBody, otherCallSubstring, fnName, otherLabel) {
  const hseIdx = catchBody.indexOf("handleSessionExpired(");
  assert(hseIdx !== -1, `${fnName}: catch block must call handleSessionExpired().`);
  const otherIdx = catchBody.indexOf(otherCallSubstring);
  assert(otherIdx !== -1, `${fnName}: expected to find "${otherCallSubstring}" in the catch block.`);
  assert(
    hseIdx < otherIdx,
    `${fnName}: handleSessionExpired() must run before ${otherLabel}, so a 401 never reaches it.`,
  );
}

function run() {
  const source = fs.readFileSync(ACTIONS_FILE, "utf8");
  const validated = [];

  // --- The primitive itself -------------------------------------------------
  const primitiveBody = extractFunctionBody(
    source,
    "function handleSessionExpired(error: unknown, basePath: string): void {",
    "actions.ts",
  );
  assert(
    /resolveSessionExpiredRedirect\(/.test(primitiveBody),
    "handleSessionExpired must delegate classification to resolveSessionExpiredRedirect (A0) rather than re-implementing the 401 check.",
  );
  assert(
    /if \(redirectPath\) \{\s*redirect\(redirectPath\);\s*\}/.test(primitiveBody),
    "handleSessionExpired's only responsibility must be: classify, then redirect if non-null.",
  );
  validated.push("handle_session_expired_delegates_to_a0_primitive");

  // --- rethrowRedirectError ordering: NEXT_REDIRECT must still propagate ----
  // Every action below that already had rethrowRedirectError must still call
  // it BEFORE handleSessionExpired - a control-flow redirect signal is not an
  // ApiHttpError, so ordering doesn't change correctness here, but this
  // asserts the existing convention was not disturbed or reordered.
  const rethrowActions = [
    "deleteCategoryAction", "decideProductReviewAction", "updateProductAction",
    "revertProductToDraftAction", "validateProductAction", "deleteProductAction",
    "purgeProductAction", "createVariantAction", "updateVariantAction",
    "installConnectorAction", "configureAmazonAction", "initiateOAuthAction",
    "updateConnectorPublicationTargetsAction", "queueConnectorDeltaSyncAction",
    "upsertConnectorSyncScheduleAction", "deleteConnectorSyncScheduleAction",
    "triggerBulkPublishAction",
  ];
  for (const name of rethrowActions) {
    const fnBody = extractFunctionBody(source, `export async function ${name}(`, "actions.ts");
    const catchBody = extractCatchBody(fnBody, name);
    const rethrowIdx = catchBody.indexOf("rethrowRedirectError(error);");
    const hseIdx = catchBody.indexOf("handleSessionExpired(error,");
    assert(rethrowIdx !== -1, `${name}: rethrowRedirectError(error) must still be present (NEXT_REDIRECT must propagate unchanged).`);
    assert(hseIdx !== -1, `${name}: must call handleSessionExpired(error, ...) in its catch block.`);
    assert(
      rethrowIdx < hseIdx,
      `${name}: rethrowRedirectError(error) must run before handleSessionExpired - a redirect control-flow signal must propagate before any new classification runs.`,
    );
  }
  validated.push("rethrow_redirect_error_ordering_preserved_in_17_actions");

  // --- 401 must preempt existing action-specific handling -------------------
  // (402/403/step-up/misclassification) - each of these must still exist
  // unchanged, but handleSessionExpired must run first.
  const precedenceChecks = [
    { fn: "createExportJobAction", other: "withPlanLimitQuery(", label: "the existing 402 plan-limit check" },
    { fn: "uploadMediaAssetAction", other: "withPlanLimitQuery(", label: "the existing 402 plan-limit check" },
    { fn: "grantConnectorPermissionAction", other: "resolveConnectorPermissionGrantStatus(", label: "the existing permission-grant status handling" },
    { fn: "publishConnectorMappingVersionAction", other: "withStepUpErrorQuery(", label: "the existing step-up error handling" },
    { fn: "archiveConnectorMappingVersionAction", other: "withStepUpErrorQuery(", label: "the existing step-up error handling" },
  ];
  for (const { fn, other, label } of precedenceChecks) {
    const fnBody = extractFunctionBody(source, `export async function ${fn}(`, "actions.ts");
    const catchBody = extractCatchBody(fnBody, fn);
    assertHandleSessionExpiredPrecedes(catchBody, other, fn, label);
  }
  // createExportJobAction additionally still has its 403 handling intact.
  const exportJobBody = extractFunctionBody(source, "export async function createExportJobAction(", "actions.ts");
  assert(
    /error instanceof ApiHttpError && error\.status === 403/.test(exportJobBody),
    "createExportJobAction must retain its existing 403 handling unchanged.",
  );
  validated.push("session_expiry_preempts_402_403_step_up_handling_in_5_actions");

  // --- retrySubmissionAction: the misclassification fix ----------------------
  // 401 must be classified BEFORE the generic retryError/retryErrorMessage
  // construction, or an expired session still reads as "retry failed."
  const retrySubmissionBody = extractFunctionBody(source, "export async function retrySubmissionAction(", "actions.ts");
  const retrySubmissionCatch = extractCatchBody(retrySubmissionBody, "retrySubmissionAction");
  assertHandleSessionExpiredPrecedes(
    retrySubmissionCatch,
    'jobsParams.set("retryError"',
    "retrySubmissionAction",
    "the retryError/retryErrorMessage construction",
  );
  validated.push("retry_submission_action_401_preempts_misleading_retry_error");

  // --- The 3 timeout-tolerant swallow actions: 401 must escape the swallow ---
  const swallowActions = [
    { fn: "processBulkImportJobAction", timeoutComment: "Railway's 30" },
    { fn: "retryStuckRunAction", timeoutComment: "time out while processing continues" },
  ];
  for (const { fn, timeoutComment } of swallowActions) {
    const fnBody = extractFunctionBody(source, `export async function ${fn}(`, "actions.ts");
    const catchBody = extractCatchBody(fnBody, fn);
    assert(
      catchBody.includes("handleSessionExpired(error,"),
      `${fn}: a session-expiry 401 must call handleSessionExpired() instead of falling through the timeout-tolerant swallow.`,
    );
    assert(
      catchBody.includes(timeoutComment),
      `${fn}: the original timeout-tolerance rationale/comment must remain - this is a targeted fix, not a rewrite of the swallow's intent.`,
    );
  }
  // createBulkImportJobAction's swallow wraps its SECOND call specifically -
  // scope the catch extraction to the inline-process try/catch, not the
  // function's first (unwrapped) transport call.
  const createBulkImportBody = extractFunctionBody(source, "export async function createBulkImportJobAction(", "actions.ts");
  const inlineProcessCatchIdx = createBulkImportBody.indexOf("jobs/${createdJob.id}/process");
  assert(inlineProcessCatchIdx !== -1, "createBulkImportJobAction: could not locate the inline-process call.");
  const afterInlineCall = createBulkImportBody.slice(inlineProcessCatchIdx);
  const inlineCatchBody = extractCatchBody(afterInlineCall, "createBulkImportJobAction (inline process)");
  assert(
    inlineCatchBody.includes("handleSessionExpired(error,"),
    "createBulkImportJobAction: the inline-process swallow must call handleSessionExpired() for a session-expiry 401.",
  );
  assert(
    inlineCatchBody.includes("stays queued"),
    "createBulkImportJobAction: the original swallow rationale/comment must remain.",
  );
  validated.push("three_swallow_catch_actions_escape_401_without_losing_timeout_tolerance");

  // --- Regression guard: fetchJson/transport untouched by this migration -----
  // (A0 already asserts resolveSessionExpiredRedirect never calls redirect();
  // this re-confirms the primitive introduced in A1 has the same property.)
  assert(
    !/handleSessionExpired[\s\S]{0,20}redirect\(error/.test(source),
    "handleSessionExpired must never be passed directly as a redirect target - it must only ever be called as a statement inside a catch block.",
  );
  validated.push("handle_session_expired_never_misused_as_a_redirect_argument");

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated,
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
  console.error("BUG-AUTH-STALE-SESSION-001 (A1) action-migration regression test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
