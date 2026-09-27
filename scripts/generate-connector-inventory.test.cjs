#!/usr/bin/env node
/* eslint-disable no-console */

"use strict";

const assert = require("node:assert/strict");

const {
  extractFrontendChannels,
  extractExhaustiveConfigMapKeys,
  SEVERITY,
  SEVERITY_RULES,
} = require("./generate-connector-inventory.cjs");

// ─── Fixtures ───────────────────────────────────────────────────────

const API_CHANNELS = ["amazon", "flipkart", "meesho", "shopify", "woocommerce"];

const FRONTEND_SRC_MATCHING = `
import { z } from "zod";
export const MARKETPLACE_CHANNELS = ["amazon", "flipkart", "meesho", "shopify", "woocommerce"] as const;
`;

const FRONTEND_SRC_WITH_STALE_MYNTRA = `
import { z } from "zod";
export const MARKETPLACE_CHANNELS = ["amazon", "flipkart", "meesho", "myntra", "shopify", "woocommerce"] as const;
`;

const FRONTEND_SRC_MISSING_MEESHO = `
import { z } from "zod";
export const MARKETPLACE_CHANNELS = ["amazon", "flipkart", "shopify", "woocommerce"] as const;
`;

const CONFIG_MAP_MATCHING = `
const CHANNEL_RULES: Record<Channel, ChannelRule> = {
  amazon: { minWidth: 1000, minHeight: 1000, aspectMin: 0.8, aspectMax: 1.91 },
  flipkart: { minWidth: 800, minHeight: 800, aspectMin: 0.75, aspectMax: 1.5 },
  meesho: { minWidth: 700, minHeight: 700, aspectMin: 0.75, aspectMax: 1.6 },
  shopify: { minWidth: 800, minHeight: 800, aspectMin: 0.5, aspectMax: 2 },
  woocommerce: { minWidth: 800, minHeight: 800, aspectMin: 0.5, aspectMax: 2 },
};
`;

const CONFIG_MAP_WITH_STALE_MYNTRA = `
const CHANNEL_RULES: Record<Channel, ChannelRule> = {
  amazon: { minWidth: 1000, minHeight: 1000, aspectMin: 0.8, aspectMax: 1.91 },
  flipkart: { minWidth: 800, minHeight: 800, aspectMin: 0.75, aspectMax: 1.5 },
  meesho: { minWidth: 700, minHeight: 700, aspectMin: 0.75, aspectMax: 1.6 },
  myntra: { minWidth: 800, minHeight: 800, aspectMin: 0.8, aspectMax: 1.5 },
  shopify: { minWidth: 800, minHeight: 800, aspectMin: 0.5, aspectMax: 2 },
  woocommerce: { minWidth: 800, minHeight: 800, aspectMin: 0.5, aspectMax: 2 },
};
`;

const CONFIG_MAP_MISSING_MEESHO = `
const CHANNEL_RULES: Record<Channel, ChannelRule> = {
  amazon: { minWidth: 1000, minHeight: 1000, aspectMin: 0.8, aspectMax: 1.91 },
  flipkart: { minWidth: 800, minHeight: 800, aspectMin: 0.75, aspectMax: 1.5 },
  shopify: { minWidth: 800, minHeight: 800, aspectMin: 0.5, aspectMax: 2 },
  woocommerce: { minWidth: 800, minHeight: 800, aspectMin: 0.5, aspectMax: 2 },
};
`;

// ─── Helpers ────────────────────────────────────────────────────────

function detectFrontendApiDrift(apiChannels, frontendChannels) {
  const findings = [];
  const apiSet = new Set(apiChannels);
  const feSet = new Set(frontendChannels);
  for (const ch of frontendChannels) {
    if (!apiSet.has(ch)) {
      findings.push({
        slug: ch,
        issue: "frontend-api-channel-sync",
        severity: SEVERITY_RULES["frontend-api-channel-sync"],
      });
    }
  }
  for (const ch of apiChannels) {
    if (!feSet.has(ch)) {
      findings.push({
        slug: ch,
        issue: "frontend-api-channel-sync",
        severity: SEVERITY_RULES["frontend-api-channel-sync"],
      });
    }
  }
  return findings;
}

function detectConfigMapDrift(canonical, mapKeys, mapSource) {
  const findings = [];
  const canonicalSet = new Set(canonical);
  const keySet = new Set(mapKeys);
  for (const key of mapKeys) {
    if (!canonicalSet.has(key)) {
      findings.push({
        slug: key,
        issue: "tier1-exhaustive-config-drift",
        severity: SEVERITY_RULES["tier1-exhaustive-config-drift"],
        source: mapSource,
      });
    }
  }
  for (const ch of canonical) {
    if (!keySet.has(ch)) {
      findings.push({
        slug: ch,
        issue: "tier1-exhaustive-config-drift",
        severity: SEVERITY_RULES["tier1-exhaustive-config-drift"],
        source: mapSource,
      });
    }
  }
  return findings;
}

// ─── Tests ──────────────────────────────────────────────────────────

function main() {
  let passed = 0;

  // ── SEVERITY_RULES entries exist ──────────────────────────────────
  assert.equal(SEVERITY_RULES["frontend-api-channel-sync"], SEVERITY.ERROR);
  assert.equal(SEVERITY_RULES["tier1-exhaustive-config-drift"], SEVERITY.ERROR);
  passed++;
  console.log("  ✓ SEVERITY_RULES entries exist and are ERROR");

  // ── extractFrontendChannels ───────────────────────────────────────
  assert.deepEqual(
    extractFrontendChannels(FRONTEND_SRC_MATCHING),
    ["amazon", "flipkart", "meesho", "shopify", "woocommerce"],
  );
  assert.deepEqual(
    extractFrontendChannels(FRONTEND_SRC_WITH_STALE_MYNTRA),
    ["amazon", "flipkart", "meesho", "myntra", "shopify", "woocommerce"],
  );
  assert.deepEqual(
    extractFrontendChannels(FRONTEND_SRC_MISSING_MEESHO),
    ["amazon", "flipkart", "shopify", "woocommerce"],
  );
  assert.equal(extractFrontendChannels(""), null);
  passed++;
  console.log("  ✓ extractFrontendChannels parses fixture sources correctly");

  // ── extractExhaustiveConfigMapKeys ────────────────────────────────
  const matchingKeys = extractExhaustiveConfigMapKeys(
    "ignored.ts",
    /CHANNEL_RULES[\s\S]*?=\s*\{([\s\S]*?)\n\};/,
    CONFIG_MAP_MATCHING,
  );
  assert.deepEqual(matchingKeys, ["amazon", "flipkart", "meesho", "shopify", "woocommerce"]);

  const staleKeys = extractExhaustiveConfigMapKeys(
    "ignored.ts",
    /CHANNEL_RULES[\s\S]*?=\s*\{([\s\S]*?)\n\};/,
    CONFIG_MAP_WITH_STALE_MYNTRA,
  );
  assert.deepEqual(staleKeys, ["amazon", "flipkart", "meesho", "myntra", "shopify", "woocommerce"]);

  const missingKeys = extractExhaustiveConfigMapKeys(
    "ignored.ts",
    /CHANNEL_RULES[\s\S]*?=\s*\{([\s\S]*?)\n\};/,
    CONFIG_MAP_MISSING_MEESHO,
  );
  assert.deepEqual(missingKeys, ["amazon", "flipkart", "shopify", "woocommerce"]);
  passed++;
  console.log("  ✓ extractExhaustiveConfigMapKeys parses fixture sources correctly");

  // ── Test 1: frontend-api-channel-sync detects drift ───────────────
  // Frontend has stale myntra → ERROR
  const driftFindings1 = detectFrontendApiDrift(
    API_CHANNELS,
    extractFrontendChannels(FRONTEND_SRC_WITH_STALE_MYNTRA),
  );
  assert.equal(driftFindings1.length, 1);
  assert.equal(driftFindings1[0].slug, "myntra");
  assert.equal(driftFindings1[0].issue, "frontend-api-channel-sync");
  assert.equal(driftFindings1[0].severity, SEVERITY.ERROR);
  passed++;
  console.log("  ✓ TEST 1a: frontend has stale myntra → frontend-api-channel-sync ERROR");

  // Frontend missing meesho → ERROR
  const driftFindings2 = detectFrontendApiDrift(
    API_CHANNELS,
    extractFrontendChannels(FRONTEND_SRC_MISSING_MEESHO),
  );
  assert.equal(driftFindings2.length, 1);
  assert.equal(driftFindings2[0].slug, "meesho");
  assert.equal(driftFindings2[0].issue, "frontend-api-channel-sync");
  assert.equal(driftFindings2[0].severity, SEVERITY.ERROR);
  passed++;
  console.log("  ✓ TEST 1b: frontend missing meesho → frontend-api-channel-sync ERROR");

  // ── Test 2: tier1-exhaustive-config-drift detects drift ───────────
  // Config map has stale myntra → ERROR
  const configFindings1 = detectConfigMapDrift(
    API_CHANNELS,
    extractExhaustiveConfigMapKeys("x.ts", /CHANNEL_RULES[\s\S]*?=\s*\{([\s\S]*?)\n\};/, CONFIG_MAP_WITH_STALE_MYNTRA),
    "test:CHANNEL_RULES",
  );
  assert.equal(configFindings1.length, 1);
  assert.equal(configFindings1[0].slug, "myntra");
  assert.equal(configFindings1[0].issue, "tier1-exhaustive-config-drift");
  assert.equal(configFindings1[0].severity, SEVERITY.ERROR);
  passed++;
  console.log("  ✓ TEST 2a: config map with stale myntra → tier1-exhaustive-config-drift ERROR");

  // Config map missing meesho → ERROR
  const configFindings2 = detectConfigMapDrift(
    API_CHANNELS,
    extractExhaustiveConfigMapKeys("x.ts", /CHANNEL_RULES[\s\S]*?=\s*\{([\s\S]*?)\n\};/, CONFIG_MAP_MISSING_MEESHO),
    "test:CHANNEL_RULES",
  );
  assert.equal(configFindings2.length, 1);
  assert.equal(configFindings2[0].slug, "meesho");
  assert.equal(configFindings2[0].issue, "tier1-exhaustive-config-drift");
  assert.equal(configFindings2[0].severity, SEVERITY.ERROR);
  passed++;
  console.log("  ✓ TEST 2b: config map missing meesho → tier1-exhaustive-config-drift ERROR");

  // ── Clean control: matching configuration → no findings ───────────
  const cleanFrontend = detectFrontendApiDrift(
    API_CHANNELS,
    extractFrontendChannels(FRONTEND_SRC_MATCHING),
  );
  assert.equal(cleanFrontend.length, 0);

  const cleanConfig = detectConfigMapDrift(
    API_CHANNELS,
    extractExhaustiveConfigMapKeys("x.ts", /CHANNEL_RULES[\s\S]*?=\s*\{([\s\S]*?)\n\};/, CONFIG_MAP_MATCHING),
    "test:CHANNEL_RULES",
  );
  assert.equal(cleanConfig.length, 0);
  passed++;
  console.log("  ✓ CLEAN CONTROL: matching configuration → 0 findings");

  console.log(`\n✅ All ${passed} test groups passed.`);
}

main();
