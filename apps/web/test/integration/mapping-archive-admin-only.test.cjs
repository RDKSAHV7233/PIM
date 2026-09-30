#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * D10 (docs/decisions/DR-2026-09-30-mapping-po-cto-rulings.md): the mapping version row offered Archive to editors and
 * channel managers, but POST .../archive is @Roles("admin") behind the admin-boundary gate, so those roles always got a
 * 403. Archive is now offered to admin only; the API stays the enforcement boundary and is not changed.
 * The capability helper is executed as code; the wiring is checked with source contracts.
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
  const { canArchiveMappingVersions, canManageChannels } = loadTsModule("lib", "role-capabilities.ts");
  const roles = ["admin", "editor", "publisher", "approver", "channel_manager", "connector_admin", "reviewer", "viewer"];
  for (const role of roles) {
    assert(canArchiveMappingVersions(role) === (role === "admin"), `${role}: archive is offered to admin only.`);
  }
  assert(canManageChannels("editor") && canManageChannels("channel_manager"), "editor and channel_manager still manage mappings (validate/publish/rollback).");

  const manager = fs.readFileSync(path.join(SRC, "components", "channel", "version-manager.tsx"), "utf8");
  assert(manager.includes('import { canArchiveMappingVersions } from "@/lib/role-capabilities"'), "version-manager must use the capability helper.");
  const gate = manager.indexOf("canArchiveMappingVersions(actorRole) ? (");
  const archiveForm = manager.indexOf("action={archiveConnectorMappingVersionAction}");
  const rollbackForm = manager.indexOf("action={rollbackConnectorMappingVersionAction}");
  assert(gate !== -1 && archiveForm > gate && rollbackForm > archiveForm, "the Archive form sits inside the admin-only gate.");
  const closing = manager.indexOf(") : null}", archiveForm);
  assert(closing !== -1 && closing < rollbackForm, "the gate closes before Rollback, so Rollback stays available to every writer.");
  assert((manager.match(/archiveConnectorMappingVersionAction/g) ?? []).length === 2, "Archive is rendered in exactly one place (import + one use).");

  console.log(JSON.stringify({ status: "ok", validated: ["archive_admin_only", "validate_publish_rollback_unchanged", "api_not_touched"] }, null, 2));
}

try {
  run();
} catch (error) {
  console.error("Mapping archive admin-only test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
