#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Regression coverage for DEF-26, found by the scratch-stack extended QA run (2026-09-30):
 * a wrong step-up password on Publish or Archive sent the operator to the login page (and, because they were
 * still signed in, on to the dashboard) instead of showing "Step-up re-authentication failed".
 * Cause: the API answers a wrong password with 401 {"error":"STEP_UP_INVALID_CREDENTIALS"}, and the session-expiry
 * classifier treated every 401 as an expired session. The classifier now skips 401s that carry a step-up code;
 * a genuine expired session ({"error":"Unauthorized"}) is unaffected, and session-expiry handling still runs
 * first in each action (BUG-AUTH-STALE-SESSION-001).
 * The helper is executed as code (ts.transpileModule); the wiring is checked with source contracts.
 */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const SRC = path.join(REPO_ROOT, "apps", "web", "src");

function loadTsModule(...parts) {
  const ts = require("typescript");
  const Module = require("node:module");
  const file = path.join(SRC, ...parts);
  const { outputText } = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: path.basename(file),
  });
  const mod = new Module(file, module);
  mod.filename = file;
  mod._compile(outputText, file);
  return mod.exports;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run() {
  const { isStepUpErrorBody, stepUpErrorCode, STEP_UP_ERROR_CODES } = loadTsModule("lib", "step-up-errors.ts");

  // What the API really returns (captured from the scratch API on 2026-09-30).
  assert(isStepUpErrorBody({ error: "STEP_UP_INVALID_CREDENTIALS" }), "a wrong step-up password is a step-up failure.");
  assert(stepUpErrorCode({ error: "STEP_UP_INVALID_CREDENTIALS" }) === "STEP_UP_INVALID_CREDENTIALS", "the code is returned.");
  for (const code of ["STEP_UP_REQUIRED", "STEP_UP_TOKEN_INVALID", "STEP_UP_TOKEN_SESSION_MISMATCH", "STEP_UP_SCOPE_MISMATCH", "STEP_UP_PASSWORD_REQUIRED"]) {
    assert(isStepUpErrorBody({ error: code }), `${code} is a step-up failure.`);
  }
  assert(STEP_UP_ERROR_CODES.size === 6, "the code list is unchanged.");

  // A genuine expired session must NOT be classified as a step-up failure.
  assert(!isStepUpErrorBody({ message: "Bearer token or API key is required.", error: "Unauthorized", statusCode: 401 }), "an expired-session 401 is not a step-up failure.");
  assert(!isStepUpErrorBody(null) && !isStepUpErrorBody(undefined) && !isStepUpErrorBody("STEP_UP_REQUIRED") && !isStepUpErrorBody([]), "non-object bodies are not step-up failures.");
  assert(!isStepUpErrorBody({ error: "step_up_required" }) && !isStepUpErrorBody({ error: "" }) && !isStepUpErrorBody({}), "only exact step-up codes count.");
  assert(!isStepUpErrorBody({ error: "PLAN_LIMIT_EXCEEDED" }), "other error codes are not step-up failures.");

  // Wiring.
  const actions = fs.readFileSync(path.join(SRC, "app", "actions.ts"), "utf8");
  assert(actions.includes('from "@/lib/step-up-errors"'), "actions.ts must use the shared step-up helper.");
  const fnStart = actions.indexOf("function resolveSessionExpiredRedirect(");
  const fn = actions.slice(fnStart, actions.indexOf("\n}\n", fnStart));
  const skip = fn.indexOf("isStepUpErrorBody(error.body)");
  const login = fn.indexOf("buildLoginRedirect(");
  assert(skip !== -1 && login !== -1 && skip < login, "resolveSessionExpiredRedirect must skip step-up 401s before building the login redirect (DEF-26).");
  assert(!actions.includes("const STEP_UP_ERROR_CODES = new Set("), "the code list must live in the shared helper only.");
  for (const verb of ["publish", "archive", "rollback"]) {
    assert(actions.includes(`withStepUpErrorQuery(redirectTo, "${verb}", versionId, error)`), `${verb} must still report step-up failures on the wizard.`);
  }

  console.log(JSON.stringify({ status: "ok", validated: ["wrong_password_is_step_up_not_session_expiry", "real_expiry_still_detected", "classifier_wired"] }, null, 2));
}

try {
  run();
} catch (error) {
  console.error("Step-up wrong-password test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
