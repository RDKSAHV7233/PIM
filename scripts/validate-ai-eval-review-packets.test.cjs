#!/usr/bin/env node

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { renderAll } = require("./render-ai-eval-review-packets.cjs");
const { validatePackets, blockedValues } = require("./validate-ai-eval-review-packets.cjs");

const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "test-fixtures", "ai-eval", "golden-catalog.v2.json"), "utf8"));
const { files } = renderAll();
const base = {
  sme: files["ai-eval-review-packet-pim-sme-2026-10-07.md"],
  qa: files["ai-eval-review-packet-qa-2026-10-07.md"],
  security: files["ai-eval-review-packet-security-2026-10-07.md"],
  matrix: files["ai-eval-approval-status-matrix-2026-10-07.md"],
};

function expectInvalid(name, documents, snippet) {
  const result = validatePackets(catalog, documents);
  assert.equal(result.ok, false, `${name} unexpectedly passed`);
  assert(result.errors.some((error) => error.includes(snippet)), `${name}: expected "${snippet}", got ${result.errors.join("; ")}`);
}

const valid = validatePackets(catalog, base);
assert.equal(valid.ok, true, `fresh render must validate: ${valid.errors.join("; ")}`);

// Positive assertions: the packets really cover the catalog, not an empty set.
assert.equal(catalog.cases.length, 64);
assert.equal(base.sme.match(/^### AI-GC-/gm).length, 64, "SME packet must have one section per case");
assert.equal(base.qa.match(/^### AI-GC-/gm).length, 64, "QA packet must have one section per case");
assert.equal(base.security.match(/^### AI-GC-/gm).length, 13, "Security packet must cover the 13 security-relevant cases");
assert(base.matrix.includes("Authoritative cases: **0 of 64**"), "no case is approved, so none is authoritative");
assert(blockedValues(catalog).length >= 4, "the catalog carries blocked payload values the packets must not print");

// Packets are valid on their own (they may land in separate PRs) but the matrix is required.
assert.equal(validatePackets(catalog, { security: base.security, matrix: base.matrix }).ok, true);
expectInvalid("matrix missing", { security: base.security }, "matrix is missing");
expectInvalid("no packets", {}, "no review packet found");

expectInvalid("stale hash", { ...base, sme: base.sme.replace(/sha256:[0-9a-f]{64}/, `sha256:${"0".repeat(64)}`) }, "stale");
expectInvalid("missing case", { ...base, qa: base.qa.replaceAll("AI-GC-SEC-005", "AI-GC-XXX-005") }, "missing case AI-GC-SEC-005");
expectInvalid("security omits a relevant case", { ...base, security: base.security.replaceAll("AI-GC-CLEAN-009", "AI-GC-CLEAN-0XX") }, "missing case AI-GC-CLEAN-009");
const leaked = blockedValues(catalog)[0];
expectInvalid("blocked value leaked", { ...base, security: `${base.security}\n${leaked}\n` }, "blocked payload field");
expectInvalid("pre-ticked decision", { ...base, sme: base.sme.replace("[ ] APPROVE", "[x] APPROVE") }, "pre-ticked");

// An approval must not break the packets (no CI friction when humans record approvals).
const approved = JSON.parse(JSON.stringify(catalog));
approved.cases[0].approvalStatus = "APPROVED";
approved.cases[0].approvals = { pimSme: { by: "reviewer-a", date: "2026-10-08" }, qa: { by: "reviewer-b", date: "2026-10-08" } };
assert.equal(validatePackets(approved, base).ok, true, "recording an approval must not invalidate the packets");

console.log("validate-ai-eval-review-packets tests passed");
