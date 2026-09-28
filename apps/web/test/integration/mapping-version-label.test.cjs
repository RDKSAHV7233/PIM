#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Regression coverage for the mapping version-manager table's "Version" column showing a
 * distinguishable per-draft label instead of the connector definition version (which is
 * identical across every version built against the same connector schema). Exercises
 * lib/mapping-version-label.ts's computeVersionOrdinals as code (via ts.transpileModule,
 * matching the mapping-working-draft.ts pattern from PR A/#990), plus a source-contract
 * check that VersionManagerCard actually wires it into the primary label.
 */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const VERSION_LABEL = path.join(REPO_ROOT, "apps", "web", "src", "lib", "mapping-version-label.ts");
const VERSION_MANAGER = path.join(REPO_ROOT, "apps", "web", "src", "components", "channel", "version-manager.tsx");

function loadVersionLabelModule() {
  const ts = require("typescript");
  const Module = require("node:module");
  const { outputText } = ts.transpileModule(fs.readFileSync(VERSION_LABEL, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: "mapping-version-label.ts",
  });
  const mod = new Module(VERSION_LABEL, module);
  mod.filename = VERSION_LABEL;
  mod._compile(outputText, VERSION_LABEL);
  return mod.exports;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function v(id, categoryScope, createdAt, overrides = {}) {
  return { id, categoryScope, mappingLevel: "category_override", createdAt, ...overrides };
}

function run() {
  assert(fs.existsSync(VERSION_LABEL), "lib/mapping-version-label.ts must exist.");
  const { computeVersionOrdinals } = loadVersionLabelModule();
  assert(typeof computeVersionOrdinals === "function", "mapping-version-label.ts must export computeVersionOrdinals.");

  // Two drafts, same scope, created in order -> distinct, creation-ordered ordinals.
  const twoDrafts = [
    v("draft-b", "scope-1", "2026-09-28T13:05:59.000Z"),
    v("draft-a", "scope-1", "2026-09-28T20:46:30.000Z"),
  ];
  const ordinals1 = computeVersionOrdinals(twoDrafts);
  assert(ordinals1.get("draft-b") === 1, "The earlier-created version must be ordinal 1.");
  assert(ordinals1.get("draft-a") === 2, "The later-created version must be ordinal 2.");

  // Different scopes never share numbering.
  const twoScopes = [
    v("s1-only", "scope-1", "2026-09-28T10:00:00.000Z"),
    v("s2-only", "scope-2", "2026-09-28T09:00:00.000Z"),
  ];
  const ordinals2 = computeVersionOrdinals(twoScopes);
  assert(ordinals2.get("s1-only") === 1 && ordinals2.get("s2-only") === 1, "Each scope's numbering starts at 1 independently.");

  // Stability: archiving an older sibling must not renumber the younger one, so the ordinal
  // must be computed over the FULL version set (archived included), never a filtered subset.
  const withArchived = [
    v("archived-first", "scope-1", "2026-09-28T08:00:00.000Z", { archivedAt: "2026-09-28T09:00:00.000Z" }),
    v("still-draft", "scope-1", "2026-09-28T10:00:00.000Z"),
  ];
  const ordinalsFull = computeVersionOrdinals(withArchived);
  assert(ordinalsFull.get("still-draft") === 2, "A version created after an archived sibling keeps its position (2), proving archived rows must count toward the ordinal.");

  const versionManager = fs.readFileSync(VERSION_MANAGER, "utf8");
  assert(
    versionManager.includes('from "@/lib/mapping-version-label"') && versionManager.includes("computeVersionOrdinals("),
    "VersionManagerCard must compute ordinals via lib/mapping-version-label's computeVersionOrdinals.",
  );
  assert(
    /Version \{versionOrdinals\.get\(version\.id\)/.test(versionManager),
    "The Version column's primary label must render the computed ordinal, not connectorDefinitionVersion alone.",
  );
  assert(
    versionManager.includes("{version.connectorDefinitionVersion}"),
    "The connector definition version must still be visible somewhere in the row (useful context), just no longer the sole/misleading distinguishing label.",
  );

  console.log("[mapping-version-label] PASS — per-scope version ordinals computed as code (creation-ordered, scope-isolated, archive-stable) and wired into VersionManagerCard's primary label.");
}

run();
