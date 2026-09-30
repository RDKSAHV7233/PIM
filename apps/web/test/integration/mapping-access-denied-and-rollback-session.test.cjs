#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Regression coverage for DEF-28 and the rollback session gap, both from the scratch-stack QA run (2026-09-30).
 * DEF-28: a signed-in role without mapping access (viewer, reviewer, publisher, ...) got a 403, the page redirected
 * it to /login?reason=forbidden, and /login bounced it to /dashboard with no explanation. A 403 now renders an
 * in-page explanation; a 401 (expired session) and a suspended tenant still leave the page.
 * Rollback: unlike publish and archive, the rollback action never ran the session-expiry check, so an expired
 * session reached the generic error page instead of sign-in.
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
  const { classifyMappingLoadFailure, describeMappingAccessDenied } = loadTsModule("lib", "mapping-access.ts");

  assert(classifyMappingLoadFailure({ status: 401, body: { error: "Unauthorized" } }) === "sign_in", "401 is an expired session.");
  assert(classifyMappingLoadFailure({ status: 403, body: { error: "Forbidden" } }) === "access_denied", "403 is a permission answer, shown on the page.");
  assert(classifyMappingLoadFailure({ status: 403, body: { message: "Forbidden resource", error: "Forbidden", statusCode: 403 } }) === "access_denied", "the Nest 403 body is a permission answer.");
  assert(classifyMappingLoadFailure({ status: 403 }) === "access_denied", "a 403 without a body is a permission answer.");
  assert(classifyMappingLoadFailure({ status: 403, body: { error: "TENANT_SUSPENDED" } }) === "sign_in", "a suspended tenant still leaves the page (login helper routes it to /account-suspended).");
  assert(classifyMappingLoadFailure({ status: 403, body: { error: "tenant_suspended" } }) === "sign_in", "the suspended check is case-insensitive like the login helper.");
  for (const other of [{ status: 500 }, { status: 404 }, { status: 402 }, null, undefined, "x", new Error("boom")]) {
    assert(classifyMappingLoadFailure(other) === "other", `${JSON.stringify(other)} is neither sign-in nor denial.`);
  }

  const denied = describeMappingAccessDenied("viewer");
  assert(/cannot open channel mappings/.test(denied.title), "the title states the problem.");
  assert(/Admin, Editor, Channel manager/.test(denied.body) && /viewer role/.test(denied.body), "the body names the roles that have access and the user's own role.");
  assert(/viewer role/.test(denied.body) && !/refused part of this page/.test(denied.body), "a role without access gets the no-access wording.");
  // A role that DOES have mapping access can still be refused a narrower permission (the review step's preflight and
  // readiness calls sit behind an admin-boundary policy). The wording must not claim that role has no access.
  const partial = describeMappingAccessDenied("channel_manager", { error: "ACCESS_POLICY_DENIED", reason: "ADMIN_BOUNDARY_FORBIDDEN" });
  assert(/needs a permission your account does not have/.test(partial.title), "a permitted role gets the narrower-permission title.");
  assert(/channel manager role, which can use channel mappings/.test(partial.body) && /ADMIN_BOUNDARY_FORBIDDEN/.test(partial.body), "the body names the role and the server's reason.");
  assert(!/cannot open channel mappings/.test(partial.title), "a permitted role is never told it cannot open mappings.");
  assert(!/[(][)]/.test(describeMappingAccessDenied("editor", {}).body), "no empty reason parentheses.");
  assert(/current role/.test(describeMappingAccessDenied("").body), "a missing role still reads sensibly.");

  const page = fs.readFileSync(path.join(SRC, "app", "channels", "mappings", "page.tsx"), "utf8");
  assert(page.includes('from "@/lib/mapping-access"'), "the page must use the shared classifier.");
  const catchStart = page.lastIndexOf("} catch (error: unknown) {");
  const tail = page.slice(catchStart);
  const signIn = tail.indexOf('failure === "sign_in"');
  const denial = tail.indexOf('failure === "access_denied"');
  const login = tail.indexOf('buildLoginRedirect("/channels/mappings", error)');
  assert(signIn !== -1 && login > signIn && denial > login, "sign-in redirect only for the sign_in class; denial handled separately.");
  assert(/role="alert"/.test(tail) && tail.includes("describeMappingAccessDenied(actorRole, error.body)"), "the denial renders an alert on the page.");
  assert(!/error\.status === 401 \|\| error\.status === 403\)\) \{\s*redirect\(buildLoginRedirect\("\/channels\/mappings"/.test(tail), "the page must no longer send every 403 to login.");

  // Review step: a permission refusal on exactly the two readiness evaluations must not remove the whole step.
  const { READINESS_RESTRICTED_NOTICE } = loadTsModule("lib", "mapping-access.ts");
  assert(/not available for your role/.test(READINESS_RESTRICTED_NOTICE.title) && /still validate and publish/.test(READINESS_RESTRICTED_NOTICE.body), "the notice says readiness is unavailable and that validate/publish still work.");
  assert(/Product exports stay blocked/.test(READINESS_RESTRICTED_NOTICE.body), "the notice does not imply the channel is ready.");
  const tolerate = page.indexOf("const tolerateReadinessDenial");
  assert(tolerate !== -1 && page.slice(tolerate, tolerate + 400).includes('classifyMappingLoadFailure(error) === "access_denied"') && page.slice(tolerate, tolerate + 500).includes("throw error;"), "denial is tolerated, everything else rethrown.");
  assert(/tolerateReadinessDenial\(\s*evaluateConnectorMappingPreflight\(/.test(page) && /tolerateReadinessDenial\(\s*evaluateConnectorPublishReadiness\(/.test(page), "exactly the preflight and publish-readiness calls are wrapped.");
  assert((page.match(/tolerateReadinessDenial\(/g) ?? []).length === 2, "no other request is wrapped.");
  assert(page.includes("{readinessRestricted ? (") && page.includes('role="status"'), "the review step shows the notice.");

  const actions = fs.readFileSync(path.join(SRC, "app", "actions.ts"), "utf8");
  const start = actions.indexOf("export async function rollbackConnectorMappingVersionAction(");
  const fn = actions.slice(start, actions.indexOf("\n}\n", start));
  const session = fn.indexOf("handleSessionExpired(error, redirectTo)");
  const stepUp = fn.indexOf('withStepUpErrorQuery(redirectTo, "rollback", versionId, error)');
  assert(session !== -1 && stepUp !== -1 && session < stepUp, "rollback must check session expiry before step-up handling, like publish and archive.");

  console.log(JSON.stringify({ status: "ok", validated: ["403_renders_in_page", "401_and_suspended_still_leave", "rollback_session_expiry_first"] }, null, 2));
}

try {
  run();
} catch (error) {
  console.error("Mapping access-denied / rollback session test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
