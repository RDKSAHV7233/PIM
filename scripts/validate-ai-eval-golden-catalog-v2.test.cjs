const assert = require("node:assert/strict");
const fs = require("node:fs");
const { DEFAULT_FIXTURE, MIN_PER_CATEGORY, readJson, validateCatalog } = require("./validate-ai-eval-golden-catalog-v2.cjs");
const v1 = require("./validate-ai-eval-golden-catalog.cjs");

const baseline = readJson();
const clone = () => JSON.parse(JSON.stringify(baseline));
const caseById = (catalog, id) => catalog.cases.find((testCase) => testCase.caseId === id);

function expectFailure(mutate, fragment, options) {
  const catalog = clone();
  mutate(catalog);
  const result = validateCatalog(catalog, options);
  assert.equal(result.ok, false, `expected failure containing "${fragment}"`);
  assert.ok(result.errors.some((error) => error.includes(fragment)), `no error contains "${fragment}":\n${result.errors.join("\n")}`);
}

// --- baseline ---
const baselineResult = validateCatalog(clone());
assert.equal(baselineResult.ok, true, baselineResult.errors.join("\n"));
assert.equal(baseline.cases.length, 64);
for (const [category, minimum] of Object.entries(MIN_PER_CATEGORY)) {
  assert.ok(baselineResult.tally[category] >= minimum, `${category} below minimum`);
}
// Nothing is authoritative until PIM SME / QA / Security approve it.
assert.equal(baseline.cases.filter((testCase) => testCase.approvalStatus === "APPROVED").length, 0);

// v1 is historical compatibility only and must stay valid and unchanged.
const v1Catalog = v1.readJson();
assert.equal(v1.validateCatalog(v1Catalog).ok, true);
assert.equal(v1Catalog.items.length, 8);

// --- composition ---
const tagsUsed = new Set(baseline.cases.flatMap((testCase) => testCase.securityTags));
for (const tag of ["prompt_injection", "instruction_in_data", "secret_exfiltration", "pii", "authority_field_override", "unsupported_claim", "guard_false_positive_probe"]) {
  assert.ok(tagsUsed.has(tag), `security tag ${tag} is not exercised`);
}
assert.ok(baseline.cases.filter((testCase) => testCase.scoring.expectedPipelineOutcome === "payload_blocked").length >= 4);
assert.equal(baseline.cases.filter((testCase) => testCase.securityTags.includes("guard_false_positive_probe")).length, 3);
assert.ok(baseline.cases.filter((testCase) => testCase.securityTags.length > 0 && testCase.scoring.criticality === "zero_tolerance").length >= 8);

// --- axes: independent, non-compensable, no invented thresholds ---
expectFailure((c) => { c.axes[0].weight = 25; }, "cross-axis weights are not allowed");
expectFailure((c) => { c.axes[1].compensable = true; }, "must be false");
expectFailure((c) => { c.axes.find((a) => a.id === "safety").threshold = 0.99; }, "safety must be gate hard_zero");
expectFailure((c) => { c.axes.find((a) => a.id === "safety").gate = "rate"; }, "safety must be gate hard_zero");
expectFailure((c) => { c.axes.find((a) => a.id === "factual").threshold = 0.95; }, "TBD_AFTER_BASELINE");
expectFailure((c) => { c.axes.pop(); }, "must be exactly structural, factual, evidence, safety");
expectFailure((c) => { c.overallScore = 90; }, "a blended score is not allowed");
expectFailure((c) => { c.cases[0].scoring.axisWeights = { factual: 1 }; }, "no cross-axis weights");

// --- header / forbidden keys ---
expectFailure((c) => { c.catalogId = "AI-EVAL-001-GOLDEN-CATALOG-V1"; }, "$.catalogId");
expectFailure((c) => { c.nonRuntime = false; }, "$.nonRuntime");
expectFailure((c) => { c.cases[0].input.provider = "x"; }, "runtime/provider binding key");
expectFailure((c) => { c.cases[3].expected.model = "x"; }, "runtime/provider binding key");

// --- ids ---
expectFailure((c) => { c.cases[1].caseId = c.cases[0].caseId; }, "duplicate AI-GC-APP-001");
expectFailure((c) => { c.cases[2].sku = c.cases[0].sku; }, "duplicate AI-GC-APP-001-SKU");
expectFailure((c) => { c.cases[0].caseId = "bad id"; }, "must match AI-GC");
expectFailure((c) => { c.cases[0].capability = "copilot"; }, "AI-001 in-scope capability");
expectFailure((c) => { c.cases[0].category = "marketing"; }, "$.cases[0].category");

// --- ground truth consistency ---
expectFailure((c) => { caseById(c, "AI-GC-CLEAN-001").expected.requiredFacts[0].value = "Nike"; }, "is not grounded in");
expectFailure((c) => { caseById(c, "AI-GC-CLEAN-001").expected.requiredFacts[0].source = "attributes.nothing"; }, "does not exist in input");
expectFailure((c) => { const k = caseById(c, "AI-GC-CLEAN-001"); k.expected.mustRemainUnknown.push("brand"); }, "both required and mustRemainUnknown");
expectFailure((c) => { const k = caseById(c, "AI-GC-CLEAN-001"); k.expected.prohibitedOutputs.push("Stridex"); }, "also a required fact value");
expectFailure((c) => { const k = caseById(c, "AI-GC-MISSING-001"); k.input.attributes.material = "plastic"; }, "so it is not unknown");
expectFailure((c) => { const k = caseById(c, "AI-GC-CLEAN-001"); k.expected.requiredFacts = []; k.provenanceExpectations = []; }, "needs at least one required fact");
expectFailure((c) => { const k = caseById(c, "AI-GC-CONFLICT-001"); k.expected.mustRemainUnknown = []; }, "must also be in mustRemainUnknown");
expectFailure((c) => { const k = caseById(c, "AI-GC-CONFLICT-001"); k.expected.conflicts[0].values[1] = "wool"; }, "is not present in");
expectFailure((c) => { const k = caseById(c, "AI-GC-CONFLICT-001"); k.expected.conflicts[0].sources.pop(); }, "one source each");

// --- provenance ---
expectFailure((c) => { caseById(c, "AI-GC-CLEAN-001").provenanceExpectations.pop(); }, "missing provenance expectation");
expectFailure((c) => { caseById(c, "AI-GC-CLEAN-001").provenanceExpectations[0].mustCite = ["nowhere"]; }, "does not exist in input");
expectFailure((c) => { caseById(c, "AI-GC-CLEAN-001").provenanceExpectations[0].minEvidence = 0; }, "minEvidence >= 1");
expectFailure((c) => { caseById(c, "AI-GC-CLEAN-001").provenanceExpectations.push({ field: "extra", mustCite: ["title"], minEvidence: 1 }); }, "is not a required fact");

// --- approvals: DRAFT until the right people approve ---
expectFailure((c) => { caseById(c, "AI-GC-CLEAN-001").approvalStatus = "APPROVED"; }, "APPROVED cases require approvals");
expectFailure((c) => { caseById(c, "AI-GC-CLEAN-001").approvalStatus = "MAYBE"; }, "must be DRAFT or APPROVED");
expectFailure((c) => { caseById(c, "AI-GC-CLEAN-001").approvals = { pimSme: { by: "a", date: "2026-10-05" } }; }, "DRAFT cases must not carry approvals");
expectFailure((c) => {
  const k = caseById(c, "AI-GC-CLEAN-001");
  k.approvalStatus = "APPROVED";
  k.approvals = { pimSme: { by: "a", date: "2026-10-05" } };
}, "approvals.qa");
expectFailure((c) => {
  const k = caseById(c, "AI-GC-SEC-005");
  k.approvalStatus = "APPROVED";
  k.approvals = { pimSme: { by: "a", date: "2026-10-05" }, qa: { by: "b", date: "2026-10-05" } };
}, "approvals.security");
expectFailure((c) => {
  const k = caseById(c, "AI-GC-CLEAN-001");
  k.approvalStatus = "APPROVED";
  k.approvals = { pimSme: { by: "a", date: "05/10/2026" }, qa: { by: "b", date: "2026-10-05" } };
}, "approvals.pimSme");
{
  const catalog = clone();
  const standard = caseById(catalog, "AI-GC-CLEAN-001");
  standard.approvalStatus = "APPROVED";
  standard.approvals = { pimSme: { by: "a", date: "2026-10-05" }, qa: { by: "b", date: "2026-10-05" } };
  const security = caseById(catalog, "AI-GC-SEC-005");
  security.approvalStatus = "APPROVED";
  security.approvals = { pimSme: { by: "a", date: "2026-10-05" }, qa: { by: "b", date: "2026-10-05" }, security: { by: "c", date: "2026-10-05" } };
  const result = validateCatalog(catalog);
  assert.equal(result.ok, true, result.errors.join("\n"));
}

// --- blocked payload cases ---
expectFailure((c) => { caseById(c, "AI-GC-SEC-001").payloadExtras = { customer: { nickname: "x" } }; }, "AI_BLOCKED policy path");
expectFailure((c) => { caseById(c, "AI-GC-SEC-001").scoring.criticality = "high"; }, "must be zero_tolerance");
expectFailure((c) => { caseById(c, "AI-GC-SEC-001").expected.requiredFacts = [{ field: "brand", value: "Sockly", source: "brand" }]; }, "must not expect facts");
expectFailure((c) => { caseById(c, "AI-GC-CLEAN-001").payloadExtras = { customer: { email: "x" } }; }, "only security_adversarial cases may carry payloadExtras");

// --- secret-like guard words must be intentional ---
expectFailure((c) => { caseById(c, "AI-GC-CLEAN-001").input.description += " Includes a secret compartment."; }, "not tagged guard_false_positive_probe");
expectFailure((c) => { caseById(c, "AI-GC-CLEAN-008").securityTags = []; }, "not tagged guard_false_positive_probe");
expectFailure((c) => { caseById(c, "AI-GC-CLEAN-001").securityTags = ["guard_false_positive_probe"]; }, "must contain a guard word");
expectFailure((c) => { caseById(c, "AI-GC-SEC-005").securityTags = []; }, "need at least one tag");
expectFailure((c) => { caseById(c, "AI-GC-SEC-005").securityTags = ["made_up"]; }, "known security tags");

// --- scoring block ---
expectFailure((c) => { caseById(c, "AI-GC-CLEAN-001").scoring.caseWeight = 0; }, "caseWeight > 0");
expectFailure((c) => { caseById(c, "AI-GC-CLEAN-001").scoring.expectedPipelineOutcome = "approved"; }, "known expectedPipelineOutcome");

// --- v1 carry-over and dataset bounds ---
expectFailure((c) => { caseById(c, "AI-GC-APP-001").input.title = "Changed"; }, "sku and input must be identical to v1");
expectFailure((c) => { caseById(c, "AI-GC-APP-001").expected.requiredFacts[0].value = "Other"; }, "must be identical to v1");
expectFailure((c) => { c.cases = c.cases.filter((k) => k.caseId !== "AI-GC-APP-001"); }, "v1 item AI-GC-APP-001 is missing");
expectFailure((c) => { c.cases = c.cases.slice(0, 20); }, "must contain 50-75 cases");
expectFailure((c) => { c.cases = c.cases.filter((k) => k.category !== "contradiction"); }, "category contradiction needs at least 6");

// --- the fixture must stay data-only and unmodified in shape ---
assert.ok(fs.existsSync(DEFAULT_FIXTURE));
assert.equal(JSON.parse(fs.readFileSync(DEFAULT_FIXTURE, "utf8")).nonRuntime, true);

console.log("AI-EVAL-002a Golden Catalog v2 validator tests passed.");
