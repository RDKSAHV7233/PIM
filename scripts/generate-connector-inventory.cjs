#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Source-Generated Connector Inventory
 *
 * Gate 0 requirement: generate a single authoritative connector inventory
 * from the codebase itself, not from a hand-maintained document.
 *
 * Reads from:
 *   1. connector.constants.ts          — canonical slug list
 *   2. connectors/<slug>/*.connector.ts — implementationStatus, capabilities
 *   3. connector-launch-policy.ts       — launchStage
 *   4. connector.registry.ts            — implementationMap wiring
 *   5. marketplace-channels.ts          — Tier-1 membership
 *   6. migrations/seed_*                — connector_definitions DB rows
 *   7. connector setup page             — credential UI coverage
 *   8. known-limitations.md             — customer-facing limitation docs
 *   9. marketplace.service.ts           — MAPPING_PACKS field maps (ADR-0009)
 *  10. connector-mapping.service.ts     — SYSTEM_CONNECTOR_DEFAULTS (ADR-0009)
 *  11. connectors/<slug>/*-category-rules/templates.ts — schema bridges (ADR-0008)
 *  12. connector adapter files          — mapping resolution boundary (ADR-0010)
 *  13. apps/web/src/lib/marketplace-channels.ts — frontend Tier-1 list (ADR-0014)
 *  14. apps/api/src/media/media.service.ts      — CHANNEL_RULES exhaustive map (ADR-0014)
 *  15. apps/web/src/lib/design-tokens.ts        — channelConfig exhaustive map (ADR-0014)
 *
 * Output: JSON inventory + Markdown table, both to stdout and optionally
 * to docs/connectors/CONNECTOR_INVENTORY.json and .md.
 *
 * Findings are classified by severity:
 *   ERROR     — architecture invariant violation; CI should fail
 *   WARNING   — incomplete/unverified state; CI may pass but reports
 *   INFO      — intentional design difference
 *   EXCEPTION — explicitly approved variance (from CONNECTOR_EXCEPTIONS.json)
 *
 * Usage:
 *   node scripts/generate-connector-inventory.cjs [--write] [--ci]
 *   --write  Persist output to docs/connectors/
 *   --ci     Label output for CI (exit 1 on ERROR findings)
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");

function read(relPath) {
  const full = path.join(REPO_ROOT, relPath);
  if (!fs.existsSync(full)) return null;
  return fs.readFileSync(full, "utf8");
}

// ─── 1. Canonical slug list from connector.constants.ts ─────────────
function extractCanonicalSlugs() {
  const src = read("apps/api/src/connector-framework/connector.constants.ts");
  if (!src) throw new Error("connector.constants.ts not found");
  const slugs = [];
  const re = /:\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    slugs.push(m[1]);
  }
  return slugs;
}

// ─── 2. Connector source files ──────────────────────────────────────
function extractConnectorSourceInfo(slug) {
  // slug to directory name mapping (slug "amazon-in" → dir "amazon", "zoho-inventory" → "zoho-inventory")
  const dirCandidates = [
    slug,
    slug.replace(/-in$/, ""),           // amazon-in → amazon
    slug.replace(/-/g, ""),             // dynamics-365 → dynamics365 — nope, try next
    slug,
  ];
  const baseDir = path.join(REPO_ROOT, "apps/api/src/connectors");
  let connectorDir = null;
  let connectorFile = null;

  // Find the actual directory
  for (const candidate of dirCandidates) {
    const dir = path.join(baseDir, candidate);
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      connectorDir = dir;
      break;
    }
  }

  // Also try listing all dirs and matching
  if (!connectorDir) {
    const dirs = fs.readdirSync(baseDir).filter((d) =>
      fs.statSync(path.join(baseDir, d)).isDirectory(),
    );
    for (const d of dirs) {
      const files = fs.readdirSync(path.join(baseDir, d));
      const connFile = files.find((f) => f.endsWith(".connector.ts"));
      if (connFile) {
        const content = fs.readFileSync(path.join(baseDir, d, connFile), "utf8");
        if (content.includes(`slug = "${slug}"`) || content.includes(`slug = '${slug}'`)) {
          connectorDir = path.join(baseDir, d);
          break;
        }
      }
    }
  }

  if (!connectorDir) {
    return { adapterExists: false, implementationStatus: null, capabilities: [], authType: null };
  }

  // Find the .connector.ts file
  const files = fs.readdirSync(connectorDir);
  const connFile = files.find((f) => f.endsWith(".connector.ts"));
  if (!connFile) {
    return { adapterExists: true, implementationStatus: null, capabilities: [], authType: null };
  }

  connectorFile = fs.readFileSync(path.join(connectorDir, connFile), "utf8");

  // Extract implementationStatus — handles both `= "full" as const` and
  // `ConnectorImplementationStatus = "full"` and `= 'partial' as const`
  const statusMatch = connectorFile.match(/implementationStatus[^=]*=\s*["'](\w+)["']/);
  const implementationStatus = statusMatch ? statusMatch[1] : null;

  // Extract capabilities
  const capsMatch = connectorFile.match(/capabilities[^=]*=\s*\[([^\]]*)\]/s);
  const capabilities = [];
  if (capsMatch) {
    const capsRe = /["'](\w+)["']/g;
    let cm;
    while ((cm = capsRe.exec(capsMatch[1])) !== null) {
      capabilities.push(cm[1]);
    }
  }

  // Extract auth type hints
  let authType = null;
  if (connectorFile.includes("OAuth2") || connectorFile.includes("oauth2") || connectorFile.includes("refresh_token")) {
    authType = "OAuth2";
  } else if (connectorFile.includes("API_KEY") || connectorFile.includes("api_key") || connectorFile.includes("apiKey")) {
    authType = "API_KEY";
  } else if (connectorFile.includes("Basic") || connectorFile.includes("basic_auth")) {
    authType = "BASIC";
  } else if (connectorFile.includes("token")) {
    authType = "TOKEN";
  }

  return { adapterExists: true, implementationStatus, capabilities, authType };
}

// ─── 3. Launch stage from connector-launch-policy.ts ────────────────
function extractLaunchStages() {
  const src = read("apps/api/src/connector-framework/connector-launch-policy.ts");
  if (!src) return {};
  const stages = {};
  // Match slug === "xxx" followed by launchStage: "xxx"
  const re = /CONNECTOR_SLUGS\.(\w+)\)[\s\S]*?launchStage:\s*["'](\w+)["']/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    stages[m[1]] = m[2];
  }
  return stages;
}

function extractLaunchStageForSlug(slug) {
  const src = read("apps/api/src/connector-framework/connector-launch-policy.ts");
  if (!src) return "unknown";
  // Look for the slug constant that maps to this slug value
  const constants = read("apps/api/src/connector-framework/connector.constants.ts");
  if (!constants) return "unknown";
  // Find the constant name for this slug
  const constRe = /(\w+):\s*["']([^"']+)["']/g;
  let constMatch;
  let constName = null;
  while ((constMatch = constRe.exec(constants)) !== null) {
    if (constMatch[2] === slug) {
      constName = constMatch[1];
      break;
    }
  }
  if (!constName) return "unknown";

  // Now find the launch stage in the policy file.
  // Some connectors (e.g. WooCommerce) have conditional overrides that return
  // a different stage under certain env conditions. We want the DEFAULT stage,
  // which is the LAST launchStage value in the connector's if-block. Find ALL
  // matches for this constant and take the last one.
  const slugPattern = new RegExp(
    `CONNECTOR_SLUGS\\.${constName}\\b[\\s\\S]*?launchStage:\\s*["'](\\w+)["']`,
    "g",
  );
  let stageMatch;
  let lastStage = null;
  // Find the block for this connector — extract just the if-block content
  const blockPattern = new RegExp(
    `if\\s*\\(\\s*slug\\s*===\\s*CONNECTOR_SLUGS\\.${constName}\\s*\\)\\s*\\{([\\s\\S]*?)^  \\}`,
    "m",
  );
  const blockMatch = src.match(blockPattern);
  if (blockMatch) {
    const blockContent = blockMatch[1];
    const stageRe = /launchStage:\s*["'](\w+)["']/g;
    let sm;
    while ((sm = stageRe.exec(blockContent)) !== null) {
      lastStage = sm[1];
    }
  }
  if (!lastStage) {
    // Fallback: try the global regex
    while ((stageMatch = slugPattern.exec(src)) !== null) {
      lastStage = stageMatch[1];
    }
  }
  return lastStage || "live"; // default fallback in the code returns "live"
}

// ─── 4. Registry wiring check ───────────────────────────────────────
function isWiredInRegistry(slug) {
  const src = read("apps/api/src/connector-framework/connector.registry.ts");
  if (!src) return false;
  // Check if the slug's connector class is injected and mapped
  return src.includes(`implementationMap.set(`) && (
    src.includes(`"${slug}"`) || src.includes(`'${slug}'`) || src.includes(`.slug`)
  );
  // All 15 are wired via their .slug property, so we check by the import
}

function getRegistryWiredSlugs() {
  const src = read("apps/api/src/connector-framework/connector.registry.ts");
  if (!src) return [];
  // Count the implementationMap.set() calls — each corresponds to one connector
  const setLines = src.match(/this\.implementationMap\.set\(/g);
  return setLines ? setLines.length : 0;
}

// ─── 5. Tier-1 membership ───────────────────────────────────────────
function getTier1Slugs() {
  const src = read("apps/api/src/marketplace/marketplace-channels.ts");
  if (!src) return [];
  const match = src.match(/MARKETPLACE_CHANNELS\s*=\s*\[([^\]]+)\]/);
  if (!match) return [];
  const slugs = [];
  const re = /["'](\w+)["']/g;
  let m;
  while ((m = re.exec(match[1])) !== null) {
    slugs.push(m[1]);
  }
  // Also get the channel→slug mapping
  const mappingMatch = src.match(/MARKETPLACE_CHANNEL_TO_CONNECTOR_SLUG[^{]*\{([^}]+)\}/s);
  const channelToSlug = {};
  if (mappingMatch) {
    const mapRe = /(\w+):\s*["']([^"']+)["']/g;
    let mm;
    while ((mm = mapRe.exec(mappingMatch[1])) !== null) {
      channelToSlug[mm[1]] = mm[2];
    }
  }
  return { channels: slugs, channelToSlug };
}

// ─── 6. Migration seed check ────────────────────────────────────────
function hasDefinitionMigration(slug) {
  const migDir = path.join(REPO_ROOT, "packages/db/prisma/migrations");
  if (!fs.existsSync(migDir)) return false;
  const dirs = fs.readdirSync(migDir);
  for (const d of dirs) {
    const sqlPath = path.join(migDir, d, "migration.sql");
    if (fs.existsSync(sqlPath)) {
      const sql = fs.readFileSync(sqlPath, "utf8");
      if (sql.includes(`'${slug}'`) && (sql.includes("connector_definitions") || sql.includes("INSERT"))) {
        return true;
      }
    }
  }
  return false;
}

// ─── 7. Credential UI check ────────────────────────────────────────
function hasCredentialUI(slug) {
  const setupPage = read("apps/web/src/app/connectors/setup/page.tsx");
  if (!setupPage) return false;
  return setupPage.includes(`"${slug}"`) || setupPage.includes(`'${slug}'`);
}

// ─── 8. Known-limitations mentions ──────────────────────────────────
function getKnownLimitationEntry(slug) {
  const doc = read("docs/product/known-limitations.md");
  if (!doc) return null;
  // Check if slug or display name is mentioned
  const slugTitle = slug.charAt(0).toUpperCase() + slug.slice(1);
  if (doc.includes(slug) || doc.includes(slugTitle)) {
    // Extract the relevant line
    const lines = doc.split("\n");
    for (const line of lines) {
      if (line.toLowerCase().includes(slug.replace(/-/g, " ")) || line.toLowerCase().includes(slug)) {
        const clean = line.replace(/^\|?\s*/, "").replace(/\s*\|?\s*$/, "").trim();
        if (clean.length > 10) return clean;
      }
    }
    return "mentioned";
  }
  return null;
}

// ─── 9. MAPPING_PACKS field maps from marketplace.service.ts (ADR-0009) ─
function extractMappingPacks() {
  const src = read("apps/api/src/marketplace/marketplace.service.ts");
  if (!src) return {};
  const blockMatch = src.match(/const\s+MAPPING_PACKS[^{]*\{([\s\S]*?)^\};/m);
  if (!blockMatch) return {};
  const block = blockMatch[1];
  const packs = {};
  const channelRe = /(\w+):\s*\{([\s\S]*?)\n  \}/g;
  let cm;
  while ((cm = channelRe.exec(block)) !== null) {
    const channel = cm[1];
    const body = cm[2];
    const fmMatch = body.match(/fieldMap:\s*\{([\s\S]*?)\}/);
    if (!fmMatch) continue;
    const fieldMap = {};
    const entryRe = /["']?([^"':,\s]+)["']?\s*:\s*["']([^"']+)["']/g;
    let em;
    while ((em = entryRe.exec(fmMatch[1])) !== null) {
      fieldMap[em[1]] = em[2];
    }
    packs[channel] = fieldMap;
  }
  return packs;
}

// ─── 10. SYSTEM_CONNECTOR_DEFAULTS from connector-mapping.service.ts (ADR-0009) ─
function extractSystemConnectorDefaults() {
  const src = read("apps/api/src/marketplace/connector-mapping.service.ts");
  if (!src) return {};
  const blockMatch = src.match(/const\s+SYSTEM_CONNECTOR_DEFAULTS[^{]*\{([\s\S]*?)^\};/m);
  if (!blockMatch) return {};
  const block = blockMatch[1];
  const defaults = {};
  // Match both quoted ("amazon-in") and unquoted (flipkart) object keys followed by ': {'
  const slugRe = /(?:["']([^"']+)["']|(\w[\w-]*))\s*:\s*\{([\s\S]*?)\}/g;
  let sm;
  while ((sm = slugRe.exec(block)) !== null) {
    const slug = sm[1] || sm[2];
    const body = sm[3];
    const fieldMap = {};
    const entryRe = /["']?([^"':,\s]+)["']?\s*:\s*["']([^"']+)["']/g;
    let em;
    while ((em = entryRe.exec(body)) !== null) {
      fieldMap[em[1]] = em[2];
    }
    defaults[slug] = fieldMap;
  }
  return defaults;
}

// ─── 11. Schema bridge and staleness check (ADR-0008) ───────────────
function checkSchemaBridge(slug) {
  const baseDir = path.join(REPO_ROOT, "apps/api/src/connectors");
  const dirCandidates = [slug, slug.replace(/-in$/, ""), slug.replace(/-/g, "")];
  let connectorDir = null;
  for (const candidate of dirCandidates) {
    const dir = path.join(baseDir, candidate);
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      connectorDir = dir;
      break;
    }
  }
  if (!connectorDir) return { hasLocalRegistry: false, hasBridge: false, staleDays: null };

  const files = fs.readdirSync(connectorDir);
  const schemaFile = files.find(
    (f) => f.endsWith("-category-rules.ts") || f.endsWith("-category-templates.ts"),
  );
  if (!schemaFile) return { hasLocalRegistry: false, hasBridge: false, staleDays: null };

  const content = fs.readFileSync(path.join(connectorDir, schemaFile), "utf8");
  const hasBridge =
    content.includes("ProductTypeSchema") ||
    content.includes("ruleToProductTypeSchema") ||
    content.includes("templateToProductTypeSchema");

  let staleDays = null;
  const dateMatches = content.match(/templateVerifiedAt[^"]*["'](\d{4}-\d{2}-\d{2})["']/g);
  if (dateMatches) {
    const now = new Date();
    for (const dm of dateMatches) {
      const dateStr = dm.match(/["'](\d{4}-\d{2}-\d{2})["']/);
      if (dateStr) {
        const d = new Date(dateStr[1]);
        const days = Math.floor((now - d) / (1000 * 60 * 60 * 24));
        if (staleDays === null || days > staleDays) staleDays = days;
      }
    }
  }

  return { hasLocalRegistry: true, hasBridge, staleDays, schemaFile };
}

// ─── 12. Adapter mapping resolution boundary check (ADR-0010) ───────
function checkAdapterMappingBoundary(slug) {
  const baseDir = path.join(REPO_ROOT, "apps/api/src/connectors");
  const dirCandidates = [slug, slug.replace(/-in$/, ""), slug.replace(/-/g, "")];
  let connectorDir = null;
  for (const candidate of dirCandidates) {
    const dir = path.join(baseDir, candidate);
    if (fs.existsSync(dir) && fs.statSync(dir).isDirectory()) {
      connectorDir = dir;
      break;
    }
  }
  if (!connectorDir) return { violatesBoundary: false };

  const files = fs.readdirSync(connectorDir);
  const connFile = files.find((f) => f.endsWith(".connector.ts"));
  if (!connFile) return { violatesBoundary: false };

  const content = fs.readFileSync(path.join(connectorDir, connFile), "utf8");
  const callsResolve =
    content.includes("resolveEffectiveMapping") ||
    content.includes("getEffectiveMapping");

  return { violatesBoundary: callsResolve };
}

// ─── 13. Frontend Tier-1 channel list (ADR-0014) ────────────────────
function extractFrontendChannels(srcOverride) {
  const src = srcOverride !== undefined ? srcOverride : read("apps/web/src/lib/marketplace-channels.ts");
  if (!src) return null;
  const match = src.match(/MARKETPLACE_CHANNELS\s*=\s*\[([^\]]+)\]/);
  if (!match) return null;
  const slugs = [];
  const re = /["'](\w+)["']/g;
  let m;
  while ((m = re.exec(match[1])) !== null) {
    slugs.push(m[1]);
  }
  return slugs;
}

// ─── 14/15. Exhaustive Tier-1 config maps (ADR-0014) ────────────────
function extractExhaustiveConfigMapKeys(filePath, mapPattern, srcOverride) {
  const src = srcOverride !== undefined ? srcOverride : read(filePath);
  if (!src) return null;
  const match = src.match(mapPattern);
  if (!match) return null;
  const keys = [];
  let indent = null;
  for (const line of match[1].split("\n")) {
    const m = line.match(/^(\s+)([\w-]+)\s*:/);
    if (!m) continue;
    if (indent === null) indent = m[1];
    if (m[1] === indent) keys.push(m[2]);
  }
  return keys;
}

function extractTier1ConfigMaps() {
  const maps = [];

  const mediaKeys = extractExhaustiveConfigMapKeys(
    "apps/api/src/media/media.service.ts",
    /CHANNEL_RULES[\s\S]*?=\s*\{([\s\S]*?)\n\};/,
  );
  if (mediaKeys) maps.push({ source: "media.service.ts:CHANNEL_RULES", keys: mediaKeys });

  const designKeys = extractExhaustiveConfigMapKeys(
    "apps/web/src/lib/design-tokens.ts",
    /channelConfig[\s\S]*?=\s*\{([\s\S]*?)\n\};/,
  );
  if (designKeys) maps.push({ source: "design-tokens.ts:channelConfig", keys: designKeys });

  const mappingKeys = extractExhaustiveConfigMapKeys(
    "apps/api/src/marketplace/marketplace.service.ts",
    /const MAPPING_PACKS[\s\S]*?=\s*\{([\s\S]*?)\n\};/,
  );
  if (mappingKeys) maps.push({ source: "marketplace.service.ts:MAPPING_PACKS", keys: mappingKeys });

  return maps;
}

// ─── Severity Classification ────────────────────────────────────────
//
// ERROR     — architecture invariant violation; CI should fail
// WARNING   — incomplete / unverified state; CI may pass but reports clearly
// INFO      — intentional design difference
// EXCEPTION — explicitly approved variance (loaded from exceptions file)
//
const SEVERITY = { ERROR: "ERROR", WARNING: "WARNING", INFO: "INFO", EXCEPTION: "EXCEPTION" };

const SEVERITY_RULES = {
  "customer-visible-but-not-runtime-registered": SEVERITY.ERROR,
  "installable-stage-but-not-runtime-registered": SEVERITY.ERROR,
  "runtime-registered-but-no-credential-ui": SEVERITY.WARNING,
  "stub-implementation-but-runtime-registered": SEVERITY.WARNING,
  "tier1-but-not-runtime-registered": SEVERITY.ERROR,
  // ADR-0009: mapping baseline invariants
  "mapping-baseline-divergence": SEVERITY.ERROR,
  "tier1-missing-system-default-baseline": SEVERITY.ERROR,
  // ADR-0008: target schema invariants
  "tier1-schema-missing-bridge": SEVERITY.WARNING,
  "schema-template-stale": SEVERITY.INFO,
  // ADR-0010: projection boundary invariant
  "adapter-resolves-mapping-directly": SEVERITY.WARNING,
  // ADR-0014: Tier-1 config-map drift invariants
  "frontend-api-channel-sync": SEVERITY.ERROR,
  "tier1-exhaustive-config-drift": SEVERITY.ERROR,
};

function loadExceptions() {
  const exPath = path.join(REPO_ROOT, "docs/connectors/CONNECTOR_EXCEPTIONS.json");
  if (!fs.existsSync(exPath)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(exPath, "utf8"));
    if (!Array.isArray(data)) return [];
    return data;
  } catch {
    return [];
  }
}

function applyExceptions(findings, exceptions) {
  for (const f of findings) {
    const match = exceptions.find(
      (ex) => ex.slug === f.slug && ex.issue === f.issue,
    );
    if (match) {
      f.severity = SEVERITY.EXCEPTION;
      f.exceptionApprovedBy = match.approvedBy || "unknown";
      f.exceptionDate = match.date || "unknown";
      f.exceptionReason = match.reason || "";
    }
  }
  return findings;
}

// ─── Main ───────────────────────────────────────────────────────────
function main() {
  const writeMode = process.argv.includes("--write");
  const ciMode = process.argv.includes("--ci");
  const slugs = extractCanonicalSlugs();
  const tier1Info = getTier1Slugs();
  const registryWiredCount = getRegistryWiredSlugs();
  const exceptions = loadExceptions();

  const inventory = slugs.map((slug) => {
    const source = extractConnectorSourceInfo(slug);
    const launchStage = extractLaunchStageForSlug(slug);
    const definitionSeeded = hasDefinitionMigration(slug);
    const credentialUI = hasCredentialUI(slug);
    const tier1Channel = tier1Info.channelToSlug
      ? Object.entries(tier1Info.channelToSlug).find(([, s]) => s === slug)
      : null;
    const isTier1 = tier1Channel !== null && tier1Channel !== undefined;
    const knownLimitation = getKnownLimitationEntry(slug);

    const runtimeRegistered = definitionSeeded;

    const installableStages = new Set([
      "live", "manual", "code_complete", "qa_validation", "po_review", "early_access",
    ]);
    const isInstallable = installableStages.has(launchStage);
    const isCustomerVisible = launchStage === "live" || launchStage === "manual";

    return {
      slug,
      adapterExists: source.adapterExists,
      implementationStatus: source.implementationStatus,
      capabilities: source.capabilities,
      authType: source.authType,
      launchStage,
      definitionSeeded,
      runtimeRegistered,
      compiledInRegistry: true,
      isInstallable,
      isCustomerVisible,
      credentialUIExists: credentialUI,
      tier: isTier1 ? "Tier-1 (marketplace)" : "Tier-2 (generic)",
      tier1Channel: tier1Channel ? tier1Channel[0] : null,
      knownLimitationEntry: knownLimitation,
    };
  });

  // ─── Summary stats ────────────────────────────────────────────────
  const summary = {
    generatedAt: new Date().toISOString(),
    generatedFrom: "origin/main",
    totalCanonicalSlugs: slugs.length,
    compiledInRegistry: registryWiredCount,
    definitionSeeded: inventory.filter((c) => c.definitionSeeded).length,
    runtimeRegistered: inventory.filter((c) => c.runtimeRegistered).length,
    customerVisible: inventory.filter((c) => c.isCustomerVisible).length,
    installable: inventory.filter((c) => c.isInstallable).length,
    tier1Count: inventory.filter((c) => c.tier.startsWith("Tier-1")).length,
    tier2Count: inventory.filter((c) => c.tier.startsWith("Tier-2")).length,
    findings: [],
  };

  // ─── Detect findings with severity ────────────────────────────────
  for (const c of inventory) {
    if (c.isCustomerVisible && !c.runtimeRegistered) {
      summary.findings.push({
        slug: c.slug,
        issue: "customer-visible-but-not-runtime-registered",
        severity: SEVERITY_RULES["customer-visible-but-not-runtime-registered"],
        detail: `Launch stage is "${c.launchStage}" (customer-visible) but no connector_definitions migration seeds a row for "${c.slug}" — this connector is unreachable at runtime.`,
      });
    }
    if (c.isInstallable && !c.runtimeRegistered) {
      summary.findings.push({
        slug: c.slug,
        issue: "installable-stage-but-not-runtime-registered",
        severity: SEVERITY_RULES["installable-stage-but-not-runtime-registered"],
        detail: `Launch stage "${c.launchStage}" is in isInstallableStage() but no DB row exists.`,
      });
    }
    if (c.runtimeRegistered && !c.credentialUIExists && c.launchStage !== "under_development" && c.launchStage !== "planned") {
      summary.findings.push({
        slug: c.slug,
        issue: "runtime-registered-but-no-credential-ui",
        severity: SEVERITY_RULES["runtime-registered-but-no-credential-ui"],
        detail: `Connector is runtime-registered but has no credential UI branch in the setup page.`,
      });
    }
    if (c.implementationStatus === "stub" && c.runtimeRegistered) {
      summary.findings.push({
        slug: c.slug,
        issue: "stub-implementation-but-runtime-registered",
        severity: SEVERITY_RULES["stub-implementation-but-runtime-registered"],
        detail: `Implementation is marked as "stub" but the connector is active in the DB — methods may throw NotImplementedError at runtime.`,
      });
    }
    if (c.tier.startsWith("Tier-1") && !c.runtimeRegistered) {
      summary.findings.push({
        slug: c.slug,
        issue: "tier1-but-not-runtime-registered",
        severity: SEVERITY_RULES["tier1-but-not-runtime-registered"],
        detail: `Connector is in Tier-1 MARKETPLACE_CHANNELS but has no connector_definitions row — Tier-1 implies runtime availability.`,
      });
    }
  }

  // ─── ADR-0009: Mapping baseline invariants ─────────────────────────
  const mappingPacks = extractMappingPacks();
  const systemDefaults = extractSystemConnectorDefaults();

  // Check 1: MAPPING_PACKS / SYSTEM_CONNECTOR_DEFAULTS intersection must not diverge
  const channelToSlugMap = tier1Info.channelToSlug || {};
  for (const [channel, packFieldMap] of Object.entries(mappingPacks)) {
    const slug = channelToSlugMap[channel];
    if (!slug) continue;
    const defaultFieldMap = systemDefaults[slug];
    if (!defaultFieldMap) continue;
    const divergent = [];
    for (const [key, packTarget] of Object.entries(packFieldMap)) {
      if (key in defaultFieldMap && defaultFieldMap[key] !== packTarget) {
        divergent.push(`${key}: MAPPING_PACKS="${packTarget}" vs SYSTEM_CONNECTOR_DEFAULTS="${defaultFieldMap[key]}"`);
      }
    }
    if (divergent.length > 0) {
      summary.findings.push({
        slug,
        issue: "mapping-baseline-divergence",
        severity: SEVERITY_RULES["mapping-baseline-divergence"],
        detail: `MAPPING_PACKS (channel="${channel}") and SYSTEM_CONNECTOR_DEFAULTS (slug="${slug}") have divergent field map values for shared keys: ${divergent.join("; ")}. ADR-0009 §2 requires these intersections to be identical.`,
      });
    }
  }

  // Check 2: Every Tier-1 connector must have a SYSTEM_CONNECTOR_DEFAULTS entry
  for (const c of inventory) {
    if (!c.tier.startsWith("Tier-1")) continue;
    const slugsToCheck = [c.slug];
    if (c.tier1Channel && channelToSlugMap[c.tier1Channel]) {
      slugsToCheck.push(channelToSlugMap[c.tier1Channel]);
    }
    const hasBaseline = slugsToCheck.some((s) => s in systemDefaults);
    if (!hasBaseline) {
      summary.findings.push({
        slug: c.slug,
        issue: "tier1-missing-system-default-baseline",
        severity: SEVERITY_RULES["tier1-missing-system-default-baseline"],
        detail: `Tier-1 connector "${c.slug}" has no entry in SYSTEM_CONNECTOR_DEFAULTS (connector-mapping.service.ts). ADR-0009 §8 requires every Tier-1 connector to have a system default baseline.`,
      });
    }
  }

  // ─── ADR-0008: Target schema invariants ───────────────────────────
  for (const c of inventory) {
    const schema = checkSchemaBridge(c.slug);
    if (c.tier.startsWith("Tier-1") && schema.hasLocalRegistry && !schema.hasBridge) {
      summary.findings.push({
        slug: c.slug,
        issue: "tier1-schema-missing-bridge",
        severity: SEVERITY_RULES["tier1-schema-missing-bridge"],
        detail: `Tier-1 connector "${c.slug}" has a local category registry (${schema.schemaFile}) but no bridge function to ProductTypeSchema. ADR-0008 §1 requires all local registries to bridge to the canonical contract.`,
      });
    }
    if (schema.hasLocalRegistry && schema.staleDays !== null && schema.staleDays > 90) {
      summary.findings.push({
        slug: c.slug,
        issue: "schema-template-stale",
        severity: SEVERITY_RULES["schema-template-stale"],
        detail: `Local schema registry for "${c.slug}" has templateVerifiedAt dates older than 90 days (${schema.staleDays} days). ADR-0008 §2 requires quarterly review for local_registry sources.`,
      });
    }
  }

  // ─── ADR-0010: Projection boundary invariant ─────────────────────
  for (const c of inventory) {
    const boundary = checkAdapterMappingBoundary(c.slug);
    if (boundary.violatesBoundary) {
      summary.findings.push({
        slug: c.slug,
        issue: "adapter-resolves-mapping-directly",
        severity: SEVERITY_RULES["adapter-resolves-mapping-directly"],
        detail: `Connector adapter for "${c.slug}" calls resolveEffectiveMapping() or getEffectiveMapping() directly. ADR-0010 §5 requires the Provider Adapter to receive a projected payload, not re-resolve mappings.`,
      });
    }
  }

  // ─── ADR-0014: Tier-1 config-map drift ──────────────────────────
  const apiChannels = getTier1Slugs().channels;
  const frontendChannels = extractFrontendChannels();
  if (apiChannels && frontendChannels) {
    const apiSet = new Set(apiChannels);
    const feSet = new Set(frontendChannels);
    for (const ch of frontendChannels) {
      if (!apiSet.has(ch)) {
        summary.findings.push({
          slug: ch,
          issue: "frontend-api-channel-sync",
          severity: SEVERITY_RULES["frontend-api-channel-sync"],
          detail: `Frontend MARKETPLACE_CHANNELS contains "${ch}" but API MARKETPLACE_CHANNELS does not. ADR-0014 §1 requires the frontend channel list to be a subset of the API authority.`,
        });
      }
    }
    for (const ch of apiChannels) {
      if (!feSet.has(ch)) {
        summary.findings.push({
          slug: ch,
          issue: "frontend-api-channel-sync",
          severity: SEVERITY_RULES["frontend-api-channel-sync"],
          detail: `API MARKETPLACE_CHANNELS contains "${ch}" but frontend MARKETPLACE_CHANNELS does not. ADR-0014 §1 requires the frontend and API channel lists to stay in sync.`,
        });
      }
    }
  }

  const tier1ConfigMaps = extractTier1ConfigMaps();
  if (apiChannels) {
    const canonical = new Set(apiChannels);
    for (const map of tier1ConfigMaps) {
      const mapKeys = new Set(map.keys);
      for (const key of map.keys) {
        if (!canonical.has(key)) {
          summary.findings.push({
            slug: key,
            issue: "tier1-exhaustive-config-drift",
            severity: SEVERITY_RULES["tier1-exhaustive-config-drift"],
            detail: `${map.source} contains key "${key}" which is not a valid MarketplaceChannel. Remove the stale entry.`,
          });
        }
      }
      for (const ch of apiChannels) {
        if (!mapKeys.has(ch)) {
          summary.findings.push({
            slug: ch,
            issue: "tier1-exhaustive-config-drift",
            severity: SEVERITY_RULES["tier1-exhaustive-config-drift"],
            detail: `${map.source} is missing required key "${ch}". Every MarketplaceChannel must have an entry.`,
          });
        }
      }
    }
  }

  applyExceptions(summary.findings, exceptions);

  // Backward compat: expose as "inconsistencies" too
  summary.inconsistencies = summary.findings;

  // Severity counts
  const severityCounts = { ERROR: 0, WARNING: 0, INFO: 0, EXCEPTION: 0 };
  for (const f of summary.findings) {
    severityCounts[f.severity] = (severityCounts[f.severity] || 0) + 1;
  }
  summary.severityCounts = severityCounts;

  // ─── Build Markdown table ─────────────────────────────────────────
  const header = "| Slug | Adapter | Status | Capabilities | Stage | DB Row | Runtime | Installable | Visible | Cred UI | Tier | Finding |";
  const sep =    "|------|---------|--------|-------------|-------|--------|---------|-------------|---------|---------|------|---------|";
  const rows = inventory.map((c) => {
    const finding = summary.findings
      .filter((f) => f.slug === c.slug)
      .map((f) => `${f.severity}: ${f.issue}`)
      .join("; ");
    return `| ${c.slug} | ${c.adapterExists ? "YES" : "NO"} | ${c.implementationStatus ?? "—"} | ${c.capabilities.join(", ") || "—"} | ${c.launchStage} | ${c.definitionSeeded ? "YES" : "NO"} | ${c.runtimeRegistered ? "YES" : "NO"} | ${c.isInstallable ? "YES" : "NO"} | ${c.isCustomerVisible ? "YES" : "NO"} | ${c.credentialUIExists ? "YES" : "NO"} | ${c.tier} | ${finding || "—"} |`;
  });

  const md = [
    "# Vexa PIM — Source-Generated Connector Inventory",
    "",
    `> **Generated:** ${summary.generatedAt}`,
    `> **Source:** \`origin/main\``,
    `> **Script:** \`scripts/generate-connector-inventory.cjs\``,
    "",
    "## Summary",
    "",
    `- **Canonical slugs:** ${summary.totalCanonicalSlugs}`,
    `- **Compiled in registry:** ${summary.compiledInRegistry}`,
    `- **Definition seeded (DB row):** ${summary.definitionSeeded}`,
    `- **Runtime registered:** ${summary.runtimeRegistered}`,
    `- **Customer-visible:** ${summary.customerVisible}`,
    `- **Installable:** ${summary.installable}`,
    `- **Tier-1 (marketplace):** ${summary.tier1Count}`,
    `- **Tier-2 (generic):** ${summary.tier2Count}`,
    "",
    "### Findings by Severity",
    "",
    `- **ERROR** (architecture invariant violation — CI blocks): ${severityCounts.ERROR}`,
    `- **WARNING** (incomplete/unverified state — CI reports): ${severityCounts.WARNING}`,
    `- **INFO** (intentional design difference): ${severityCounts.INFO}`,
    `- **EXCEPTION** (explicitly approved variance): ${severityCounts.EXCEPTION}`,
    "",
    "## Inventory",
    "",
    header,
    sep,
    ...rows,
    "",
  ];

  if (summary.findings.length > 0) {
    const grouped = {};
    for (const sev of ["ERROR", "WARNING", "INFO", "EXCEPTION"]) {
      const items = summary.findings.filter((f) => f.severity === sev);
      if (items.length > 0) grouped[sev] = items;
    }

    md.push("## Findings");
    md.push("");
    for (const [sev, items] of Object.entries(grouped)) {
      const icon = sev === "ERROR" ? "🔴" : sev === "WARNING" ? "🟡" : sev === "INFO" ? "🔵" : "🟢";
      md.push(`### ${icon} ${sev}`);
      md.push("");
      for (const f of items) {
        md.push(`**${f.slug}** — \`${f.issue}\``);
        md.push("");
        md.push(f.detail);
        if (f.exceptionReason) {
          md.push("");
          md.push(`> Approved by ${f.exceptionApprovedBy} on ${f.exceptionDate}: ${f.exceptionReason}`);
        }
        md.push("");
      }
    }
  } else {
    md.push("## No Findings");
    md.push("");
  }

  const mdText = md.join("\n");

  // ─── Output ───────────────────────────────────────────────────────
  const output = { summary, inventory };

  if (writeMode) {
    const outDir = path.join(REPO_ROOT, "docs/connectors");
    if (!fs.existsSync(outDir)) {
      fs.mkdirSync(outDir, { recursive: true });
    }
    fs.writeFileSync(path.join(outDir, "CONNECTOR_INVENTORY.json"), JSON.stringify(output, null, 2) + "\n");
    fs.writeFileSync(path.join(outDir, "CONNECTOR_INVENTORY.md"), mdText);
    console.log("Written to:");
    console.log("  docs/connectors/CONNECTOR_INVENTORY.json");
    console.log("  docs/connectors/CONNECTOR_INVENTORY.md");
    console.log("");
  }

  console.log(mdText);

  // CI exit codes: exit 1 only on ERROR findings not covered by EXCEPTION
  const errors = summary.findings.filter((f) => f.severity === SEVERITY.ERROR);
  const warnings = summary.findings.filter((f) => f.severity === SEVERITY.WARNING);

  if (errors.length > 0) {
    console.error(`\n🔴 ${errors.length} ERROR finding(s) — architecture invariant violations.`);
    if (warnings.length > 0) {
      console.error(`🟡 ${warnings.length} WARNING finding(s) — incomplete/unverified state.`);
    }
    if (ciMode) {
      console.error("CI mode: failing on ERROR findings.");
    }
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.error(`\n🟡 ${warnings.length} WARNING finding(s) — incomplete/unverified state (not blocking CI).`);
    // Warnings don't fail CI but exit 0
  }

  if (summary.findings.length === 0) {
    console.log("\n✅ No findings detected.");
  }
}

if (require.main === module) main();

module.exports = {
  extractFrontendChannels,
  extractExhaustiveConfigMapKeys,
  SEVERITY,
  SEVERITY_RULES,
};
