#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * D9 (docs/decisions/DR-2026-09-30-mapping-po-cto-rulings.md): publishing a Blocked mapping version is intentional, it is
 * how a category is declared unsupported for a connector (apps/api integration test connector-mapping-bulk-coverage,
 * Test 9). Because the consequence is strong, the Publish panel of a Blocked version explains it. The warning must
 * explain, never prevent: the Publish control stays governed only by the lifecycle and fallback rules.
 */
const fs = require("node:fs");
const path = require("node:path");

const SRC = path.resolve(__dirname, "../../../..", "apps", "web", "src");

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
  const { BLOCKED_PUBLISH_WARNING } = loadTsModule("lib", "mapping-access.ts");
  assert(/Blocked/.test(BLOCKED_PUBLISH_WARNING.title) && /not ready/.test(BLOCKED_PUBLISH_WARNING.title), "the title names the consequence.");
  assert(/live version for this scope/.test(BLOCKED_PUBLISH_WARNING.body), "the body says it becomes the live version for the scope.");
  assert(/not ready for product publishing/.test(BLOCKED_PUBLISH_WARNING.body), "the body says product publishing becomes not ready.");
  assert(/Other categories are not affected/.test(BLOCKED_PUBLISH_WARNING.body), "the body says siblings are unaffected (Test 9).");
  assert(/You can still publish it/.test(BLOCKED_PUBLISH_WARNING.body), "the body does not imply the action is refused.");

  const manager = fs.readFileSync(path.join(SRC, "components", "channel", "version-manager.tsx"), "utf8");
  assert(manager.includes('import { BLOCKED_PUBLISH_WARNING } from "@/lib/mapping-access"'), "version-manager must use the shared warning text.");
  const warning = manager.indexOf('version.compatibilityState === "blocked" ? (');
  const publishForm = manager.indexOf("action={publishConnectorMappingVersionAction}");
  const archiveGate = manager.indexOf("canArchiveMappingVersions(actorRole) ? (");
  assert(warning > publishForm && warning < archiveGate, "the warning sits inside the Publish panel.");

  // The warning must never change whether Publish is enabled.
  const disabledLine = manager.slice(publishForm, publishForm + 900).split("\n").find((line) => line.includes("disabled={"));
  assert(disabledLine && !/compatibilityState|blocked/.test(disabledLine), "the Publish disabled rule must not depend on compatibility.");

  console.log(JSON.stringify({ status: "ok", validated: ["warning_text_explains_consequence", "warning_inside_publish_panel", "publish_never_disabled_by_compatibility"] }, null, 2));
}

try {
  run();
} catch (error) {
  console.error("Mapping blocked-publish warning test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
