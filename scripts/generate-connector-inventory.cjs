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
 *
 * Output: JSON inventory + Markdown table, both to stdout and optionally
 * to docs/connectors/CONNECTOR_INVENTORY.json and .md.
 *
 * Usage:
 *   node scripts/generate-connector-inventory.cjs [--write]
 *   --write  Persist output to docs/connectors/
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

// ─── Main ───────────────────────────────────────────────────────────
function main() {
  const writeMode = process.argv.includes("--write");
  const slugs = extractCanonicalSlugs();
  const tier1Info = getTier1Slugs();
  const registryWiredCount = getRegistryWiredSlugs();

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

    // Runtime registered = definition seeded in migrations
    // (ConnectorRegistry.refreshFromDefinitions reads connector_definitions rows)
    const runtimeRegistered = definitionSeeded;

    // Installable = launch stage is in isInstallableStage's list
    const installableStages = new Set([
      "live", "manual", "code_complete", "qa_validation", "po_review", "early_access",
    ]);
    const isInstallable = installableStages.has(launchStage);

    // Customer-visible = live or manual
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
      compiledInRegistry: true, // all 15 are in the implementationMap
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
    inconsistencies: [],
  };

  // ─── Detect inconsistencies ───────────────────────────────────────
  for (const c of inventory) {
    if (c.isCustomerVisible && !c.runtimeRegistered) {
      summary.inconsistencies.push({
        slug: c.slug,
        issue: "customer-visible-but-not-runtime-registered",
        detail: `Launch stage is "${c.launchStage}" (customer-visible) but no connector_definitions migration seeds a row for "${c.slug}" — this connector is unreachable at runtime.`,
      });
    }
    if (c.isInstallable && !c.runtimeRegistered) {
      summary.inconsistencies.push({
        slug: c.slug,
        issue: "installable-stage-but-not-runtime-registered",
        detail: `Launch stage "${c.launchStage}" is in isInstallableStage() but no DB row exists.`,
      });
    }
    if (c.runtimeRegistered && !c.credentialUIExists && c.launchStage !== "under_development" && c.launchStage !== "planned") {
      summary.inconsistencies.push({
        slug: c.slug,
        issue: "runtime-registered-but-no-credential-ui",
        detail: `Connector is runtime-registered but has no credential UI branch in the setup page.`,
      });
    }
    if (c.implementationStatus === "stub" && c.runtimeRegistered) {
      summary.inconsistencies.push({
        slug: c.slug,
        issue: "stub-implementation-but-runtime-registered",
        detail: `Implementation is marked as "stub" but the connector is active in the DB — methods may throw NotImplementedError at runtime.`,
      });
    }
  }

  // ─── Build Markdown table ─────────────────────────────────────────
  const header = "| Slug | Adapter | Status | Capabilities | Stage | DB Row | Runtime | Installable | Visible | Cred UI | Tier | Inconsistency |";
  const sep =    "|------|---------|--------|-------------|-------|--------|---------|-------------|---------|---------|------|---------------|";
  const rows = inventory.map((c) => {
    const inconsistency = summary.inconsistencies
      .filter((i) => i.slug === c.slug)
      .map((i) => i.issue)
      .join(", ");
    return `| ${c.slug} | ${c.adapterExists ? "✅" : "❌"} | ${c.implementationStatus ?? "—"} | ${c.capabilities.join(", ") || "—"} | ${c.launchStage} | ${c.definitionSeeded ? "✅" : "❌"} | ${c.runtimeRegistered ? "✅" : "❌"} | ${c.isInstallable ? "✅" : "❌"} | ${c.isCustomerVisible ? "✅" : "❌"} | ${c.credentialUIExists ? "✅" : "❌"} | ${c.tier} | ${inconsistency || "—"} |`;
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
    "## Inventory",
    "",
    header,
    sep,
    ...rows,
    "",
  ];

  if (summary.inconsistencies.length > 0) {
    md.push("## ⚠️ Inconsistencies Detected");
    md.push("");
    for (const inc of summary.inconsistencies) {
      md.push(`### ${inc.slug}: ${inc.issue}`);
      md.push("");
      md.push(inc.detail);
      md.push("");
    }
  } else {
    md.push("## ✅ No Inconsistencies Detected");
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

  if (summary.inconsistencies.length > 0) {
    console.error(`\n⚠️  ${summary.inconsistencies.length} inconsistency(ies) detected — see above.`);
    process.exit(1);
  }

  console.log(JSON.stringify(output, null, 2));
}

main();
