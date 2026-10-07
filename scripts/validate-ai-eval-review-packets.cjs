#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

/**
 * Guards the Golden Catalog review packets (Stream B, B1).
 *
 * It fails when a packet is stale against the catalog's CONTENT hash, when a packet omits a case it must cover, or when a packet
 * contains the value of a blocked payload field. It deliberately does NOT fail when someone records an approval: approvals do not
 * change the content hash, and the status matrix is a snapshot that is regenerated on demand, so approving cases adds no CI friction.
 * It never edits a packet, a case or an approval.
 */
const fs = require("node:fs");
const path = require("node:path");
const { catalogContentHash } = require("./render-ai-eval-review-packets.cjs");

const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_CATALOG = path.join(REPO_ROOT, "test-fixtures", "ai-eval", "golden-catalog.v2.json");
const DOCS_DIR = path.join(REPO_ROOT, "docs", "qa");
const PACKETS = {
  sme: "ai-eval-review-packet-pim-sme-2026-10-07.md",
  qa: "ai-eval-review-packet-qa-2026-10-07.md",
  security: "ai-eval-review-packet-security-2026-10-07.md",
  matrix: "ai-eval-approval-status-matrix-2026-10-07.md",
};

function securityRelevant(testCase) {
  return testCase.category === "security_adversarial" || (testCase.securityTags ?? []).length > 0;
}

function blockedValues(catalog) {
  return catalog.cases
    .filter((testCase) => testCase.payloadExtras)
    .flatMap((testCase) => Object.values(testCase.payloadExtras).flatMap((group) => Object.values(group)))
    .map((value) => String(value))
    .filter((value) => value.length >= 4);
}

/** `documents` maps a packet key to its text; a key that is absent is skipped (packets may land in separate PRs). */
function validatePackets(catalog, documents) {
  const errors = [];
  const hash = catalogContentHash(catalog);
  const present = Object.keys(documents);
  if (present.length === 0) {
    errors.push("no review packet found");
  }
  for (const key of present) {
    const text = documents[key];
    if (!text.includes(`Catalog content hash: \`${hash}\``)) {
      errors.push(`${key}: packet is stale or missing the catalog content hash ${hash}`);
    }
    const expectedIds =
      key === "security" ? catalog.cases.filter(securityRelevant) : key === "matrix" || key === "sme" || key === "qa" ? catalog.cases : [];
    for (const testCase of expectedIds) {
      if (!text.includes(testCase.caseId)) {
        errors.push(`${key}: missing case ${testCase.caseId}`);
      }
    }
    for (const value of blockedValues(catalog)) {
      if (text.includes(value)) {
        errors.push(`${key}: contains the value of a blocked payload field`);
        break;
      }
    }
    if (/\[x\]|\[X\]/.test(text) && key !== "matrix") {
      errors.push(`${key}: a reviewer decision box is pre-ticked; packets must ship with every decision blank`);
    }
  }
  if (documents.matrix === undefined && present.length > 0) {
    errors.push("the approval status matrix is missing");
  }
  return { ok: errors.length === 0, errors };
}

function loadDocuments() {
  const documents = {};
  for (const [key, name] of Object.entries(PACKETS)) {
    const file = path.join(DOCS_DIR, name);
    if (fs.existsSync(file)) {
      documents[key] = fs.readFileSync(file, "utf8");
    }
  }
  return documents;
}

function runCli() {
  const catalog = JSON.parse(fs.readFileSync(DEFAULT_CATALOG, "utf8"));
  const result = validatePackets(catalog, loadDocuments());
  if (!result.ok) {
    console.error("AI-EVAL review packet validation failed:");
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }
  console.log(`AI-EVAL review packets valid (${Object.keys(loadDocuments()).length} document(s), catalog hash current, no blocked values, decisions blank)`);
}

if (require.main === module) {
  runCli();
}

module.exports = { validatePackets, loadDocuments, blockedValues, PACKETS };
