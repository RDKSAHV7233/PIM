#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

/**
 * QA-AI-01 (#1236): the internal AI Lab (`/ai`) and its repair server action are available only behind an explicit, fail-closed flag,
 * never the environment name (the one deployment that serves production is named "Staging").
 *
 * Runtime part: the real `isInternalAiLabEnabled` from apps/web/src/lib/internal-ai-lab.ts is transpiled and run over a value table.
 * Source part: the page and the server action both use it, the page no longer keys on APP_ENV, and the action checks the flag before
 * it posts anything.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

function loadHelper() {
  const source = read("apps/web/src/lib/internal-ai-lab.ts");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function("module", "exports", js)(module, module.exports);
  return module.exports;
}

const { isInternalAiLabEnabled, INTERNAL_AI_LAB_FLAG_ENV } = loadHelper();
assert.equal(INTERNAL_AI_LAB_FLAG_ENV, "FEATURE_INTERNAL_AI_LAB_ENABLED");

// ---- the flag: fail-closed ---------------------------------------------------------------------------------------------------------------
const table = [
  [undefined, false],
  ["", false],
  ["false", false],
  ["0", false],
  ["yes", false],
  ["1", false],
  ["truee", false],
  ["tru e", false],
  ["true", true],
  [" TRUE ", true],
  ["True", true],
];
for (const [value, expected] of table) {
  const env = value === undefined ? {} : { [INTERNAL_AI_LAB_FLAG_ENV]: value };
  assert.equal(isInternalAiLabEnabled(env), expected, `flag value ${JSON.stringify(value)} must give ${expected}`);
}
// APP_ENV must not influence it in either direction.
assert.equal(isInternalAiLabEnabled({ APP_ENV: "development" }), false, "APP_ENV=development must not enable the lab");
assert.equal(isInternalAiLabEnabled({ APP_ENV: "staging" }), false, "APP_ENV=staging must not enable the lab");
assert.equal(isInternalAiLabEnabled({ APP_ENV: "production", [INTERNAL_AI_LAB_FLAG_ENV]: "true" }), true, "an explicit flag decides, whatever APP_ENV says");

// ---- the page ----------------------------------------------------------------------------------------------------------------------------
const page = read("apps/web/src/app/ai/page.tsx");
assert(page.includes('from "@/lib/internal-ai-lab"'), "the /ai page must import the flag helper");
assert(/if \(!isInternalAiLabEnabled\(\) \|\| actorRole !== "admin"\) \{\s*(?:\/\/[^\n]*\n\s*)*notFound\(\);/.test(page), "the /ai page must call notFound() unless the flag is on and the actor is an admin");
assert(!/process\.env\.APP_ENV/.test(page), "the /ai page must not key on APP_ENV");
assert(page.indexOf("isInternalAiLabEnabled()") < page.indexOf("getBillingPlanTier("), "the flag check must come before any data is fetched");

// ---- the server action -------------------------------------------------------------------------------------------------------------------
const actions = read("apps/web/src/app/actions.ts");
const start = actions.indexOf("export async function applyAiRepairAction");
assert(start > 0, "applyAiRepairAction must exist");
const body = actions.slice(start, actions.indexOf("\n}\n", start));
assert(/^[^]*?if \(!isInternalAiLabEnabled\(\)\) \{\s*notFound\(\);\s*\}/.test(body), "the repair action must refuse without the flag");
assert(/actorRole !== "admin"/.test(body), "the repair action must require an admin session");
assert(body.indexOf("isInternalAiLabEnabled()") < body.indexOf("postJsonForAction"), "the flag check must come before the repair is posted");
assert(body.indexOf('actorRole !== "admin"') < body.indexOf("postJsonForAction"), "the role check must come before the repair is posted");
assert(/import \{ notFound, redirect \} from "next\/navigation"/.test(actions), "actions.ts must import notFound");

// ---- the lab is still not linked from the sidebar ---------------------------------------------------------------------------------------
const shell = read("apps/web/src/components/nav/authenticated-shell.tsx");
assert(!/showInternal=\{true\}/.test(shell), "no authenticated shell may switch the Internal sidebar section on");

console.log("ai-lab-gate test passed");
