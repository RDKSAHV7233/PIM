#!/usr/bin/env node

// AI-EVAL-002a: static validation of the Golden Catalog v2 fixture.
// Data-only: no provider, no network, no runtime import. v1 is validated separately and stays unchanged.

const fs = require("node:fs");
const path = require("node:path");
const { RUNTIME_PROVIDER_KEYS } = require("./validate-ai-eval-golden-catalog.cjs");

const FIXTURE_DIR = path.resolve(__dirname, "..", "test-fixtures");
const DEFAULT_FIXTURE = path.join(FIXTURE_DIR, "ai-eval", "golden-catalog.v2.json");
const V1_FIXTURE = path.join(FIXTURE_DIR, "ai-eval", "golden-catalog.v1.json");
const POLICY_FIXTURE = path.join(FIXTURE_DIR, "ai-policy", "provider-payload-policy.v1.json");

const AXES = ["structural", "factual", "evidence", "safety"];
const CAPABILITIES = new Set(["product_attribute_extraction", "product_specification_extraction", "evidence_backed_suggestions"]);
const MIN_PER_CATEGORY = {
  clean_extraction: 12,
  messy_supplier_text: 10,
  units_specs: 8,
  ambiguity: 6,
  contradiction: 6,
  invalid_data: 6,
  missing_data: 6,
  security_adversarial: 10,
};
const CATEGORIES = new Set(Object.keys(MIN_PER_CATEGORY));
const SECURITY_TAGS = new Set([
  "prompt_injection",
  "instruction_in_data",
  "secret_exfiltration",
  "pii",
  "authority_field_override",
  "unsupported_claim",
  "guard_false_positive_probe",
]);
const OUTCOMES = new Set(["succeeded", "payload_blocked", "output_rejected"]);
const CRITICALITIES = new Set(["standard", "high", "zero_tolerance"]);
const APPROVAL_ROLES = new Set(["pimSme", "qa", "security"]);
const CASE_ID = /^AI-GC-[A-Z]+-\d{3}$/;
// Mirrors the intelligence service secret-text guard so intentional probes are tagged and accidents are caught.
const SECRET_LIKE = /\b(api[_ -]?key|bearer\s+|oauth|access[_ -]?token|refresh[_ -]?token|private[_ -]?key|secret|credential|password|token)(?=\b|_)/i;
const MIN_CASES = 50;
const MAX_CASES = 75;

function readJson(filePath = DEFAULT_FIXTURE) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function fail(errors, label, message) {
  errors.push(`${label}: ${message}`);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function walkForForbiddenKeys(value, errors, label = "$") {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkForForbiddenKeys(entry, errors, `${label}[${index}]`));
    return;
  }
  if (!isObject(value)) {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (RUNTIME_PROVIDER_KEYS.has(key)) {
      fail(errors, `${label}.${key}`, "runtime/provider binding key is not allowed in Golden Catalog fixtures");
    }
    walkForForbiddenKeys(child, errors, `${label}.${key}`);
  }
}

// v1 facts reference sources as "input.brand"; v2 uses "brand". Both resolve against the case input.
function resolvePath(root, dotted) {
  let current = root;
  for (const segment of String(dotted).replace(/^input./, "").split(".")) {
    if (!isObject(current) || !(segment in current)) {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function textOf(value) {
  if (value === undefined || value === null) {
    return "";
  }
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function containsValue(sourceValue, expected) {
  if (Array.isArray(expected)) {
    return expected.length > 0 && expected.every((entry) => containsValue(sourceValue, entry));
  }
  return textOf(sourceValue).toLowerCase().includes(textOf(expected).toLowerCase());
}

function allStrings(value, out = []) {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((entry) => allStrings(entry, out));
  } else if (isObject(value)) {
    Object.values(value).forEach((entry) => allStrings(entry, out));
  }
  return out;
}

function leafPaths(value, prefix = "") {
  if (!isObject(value)) {
    return prefix ? [prefix] : [];
  }
  return Object.entries(value).flatMap(([key, child]) => leafPaths(child, prefix ? `${prefix}.${key}` : key));
}

function blockedPolicyPaths() {
  const policy = readJson(POLICY_FIXTURE);
  return new Set(policy.fields.filter((field) => field.classification === "AI_BLOCKED").map((field) => field.path));
}

function validateAxes(catalog, errors) {
  if (!Array.isArray(catalog.axes)) {
    fail(errors, "$.axes", "must be an array");
    return;
  }
  const ids = catalog.axes.map((axis) => axis?.id);
  if (ids.length !== AXES.length || !AXES.every((id) => ids.includes(id))) {
    fail(errors, "$.axes", `must be exactly ${AXES.join(", ")}`);
  }
  catalog.axes.forEach((axis, index) => {
    const label = `$.axes[${index}]`;
    if (!isObject(axis)) {
      fail(errors, label, "axis must be an object");
      return;
    }
    if ("weight" in axis) {
      fail(errors, `${label}.weight`, "axes are independent: cross-axis weights are not allowed");
    }
    if (axis.compensable !== false) {
      fail(errors, `${label}.compensable`, "must be false: no axis may offset another");
    }
    if (axis.id === "safety") {
      if (axis.gate !== "hard_zero" || axis.threshold !== 0) {
        fail(errors, label, "safety must be gate hard_zero with threshold 0");
      }
    } else if (axis.gate !== "rate" || axis.threshold !== "TBD_AFTER_BASELINE") {
      fail(errors, label, "non-safety axes must be gate rate with threshold TBD_AFTER_BASELINE until FULL baselines exist");
    }
  });
  for (const forbidden of ["overallScore", "aggregateScore", "totalScore", "weightedScore"]) {
    if (forbidden in catalog) {
      fail(errors, `$.${forbidden}`, "a blended score is not allowed");
    }
  }
}

function validateFacts(errors, label, input, expected) {
  const unknown = new Set(expected.mustRemainUnknown);
  const conflictFields = new Set((expected.conflicts || []).map((conflict) => conflict.field));

  expected.requiredFacts.forEach((fact, index) => {
    const factLabel = `${label}.expected.requiredFacts[${index}]`;
    if (!fact.field || fact.value === undefined || !fact.source) {
      fail(errors, factLabel, "requires field, value and source");
      return;
    }
    const source = resolvePath(input, fact.source);
    if (source === undefined) {
      fail(errors, `${factLabel}.source`, `${fact.source} does not exist in input`);
    } else if (!containsValue(source, fact.value)) {
      fail(errors, factLabel, `value ${JSON.stringify(fact.value)} is not grounded in ${fact.source}`);
    }
    if (unknown.has(fact.field)) {
      fail(errors, factLabel, `field ${fact.field} is both required and mustRemainUnknown`);
    }
  });

  const requiredValues = new Set(expected.requiredFacts.map((fact) => textOf(fact.value).toLowerCase()));
  expected.prohibitedOutputs.forEach((entry, index) => {
    if (typeof entry !== "string" || !entry.trim()) {
      fail(errors, `${label}.expected.prohibitedOutputs[${index}]`, "must be a non-empty string");
    } else if (requiredValues.has(entry.toLowerCase())) {
      fail(errors, `${label}.expected.prohibitedOutputs[${index}]`, `${entry} is also a required fact value`);
    }
  });

  expected.mustRemainUnknown.forEach((field) => {
    if (isObject(input.attributes) && field in input.attributes && !conflictFields.has(field)) {
      fail(errors, `${label}.expected.mustRemainUnknown`, `${field} is present in input.attributes, so it is not unknown`);
    }
  });

  (expected.conflicts || []).forEach((conflict, index) => {
    const conflictLabel = `${label}.expected.conflicts[${index}]`;
    if (!unknown.has(conflict.field)) {
      fail(errors, conflictLabel, `field ${conflict.field} must also be in mustRemainUnknown`);
    }
    if (!Array.isArray(conflict.values) || conflict.values.length < 2 || !Array.isArray(conflict.sources) || conflict.sources.length !== conflict.values.length) {
      fail(errors, conflictLabel, "requires at least two values with one source each");
      return;
    }
    conflict.values.forEach((value, valueIndex) => {
      const source = resolvePath(input, conflict.sources[valueIndex]);
      if (source === undefined || !containsValue(source, value)) {
        fail(errors, conflictLabel, `value ${JSON.stringify(value)} is not present in ${conflict.sources[valueIndex]}`);
      }
    });
  });
}

function validateProvenance(errors, label, input, expected, provenance) {
  if (!Array.isArray(provenance)) {
    fail(errors, `${label}.provenanceExpectations`, "must be an array");
    return;
  }
  const required = new Set(expected.requiredFacts.map((fact) => fact.field));
  const covered = new Set();
  provenance.forEach((entry, index) => {
    const entryLabel = `${label}.provenanceExpectations[${index}]`;
    if (!entry.field || !Array.isArray(entry.mustCite) || entry.mustCite.length === 0 || !Number.isInteger(entry.minEvidence) || entry.minEvidence < 1) {
      fail(errors, entryLabel, "requires field, non-empty mustCite and minEvidence >= 1");
      return;
    }
    covered.add(entry.field);
    entry.mustCite.forEach((source) => {
      if (resolvePath(input, source) === undefined) {
        fail(errors, `${entryLabel}.mustCite`, `${source} does not exist in input`);
      }
    });
    if (!required.has(entry.field)) {
      fail(errors, entryLabel, `field ${entry.field} is not a required fact`);
    }
  });
  for (const field of required) {
    if (!covered.has(field)) {
      fail(errors, `${label}.provenanceExpectations`, `missing provenance expectation for required fact ${field}`);
    }
  }
}

function validateApproval(errors, label, testCase, catalog) {
  if (testCase.approvalStatus !== "DRAFT" && testCase.approvalStatus !== "APPROVED") {
    fail(errors, `${label}.approvalStatus`, "must be DRAFT or APPROVED");
    return;
  }
  if (testCase.approvalStatus === "DRAFT") {
    if ("approvals" in testCase) {
      fail(errors, `${label}.approvals`, "DRAFT cases must not carry approvals");
    }
    return;
  }
  const policy = catalog.approvalPolicy?.requiredApprovers || {};
  const required = policy[testCase.category] || policy.default || [];
  const approvals = testCase.approvals;
  if (!isObject(approvals)) {
    fail(errors, `${label}.approvals`, "APPROVED cases require approvals");
    return;
  }
  for (const role of required) {
    const approval = approvals[role];
    if (!isObject(approval) || !approval.by || !/^\d{4}-\d{2}-\d{2}$/.test(String(approval.date))) {
      fail(errors, `${label}.approvals.${role}`, "required approver needs by and date (YYYY-MM-DD)");
    }
  }
  for (const role of Object.keys(approvals)) {
    if (!APPROVAL_ROLES.has(role)) {
      fail(errors, `${label}.approvals.${role}`, "unknown approver role");
    }
  }
}

function validateCase(testCase, index, catalog, blockedPaths, errors) {
  const label = `$.cases[${index}]`;
  if (!isObject(testCase)) {
    fail(errors, label, "case must be an object");
    return;
  }
  if (!CASE_ID.test(String(testCase.caseId))) {
    fail(errors, `${label}.caseId`, "must match AI-GC-<AREA>-<NNN>");
  }
  if (!testCase.sku || typeof testCase.sku !== "string") {
    fail(errors, `${label}.sku`, "must be a non-empty string");
  }
  if (!testCase.scenario || typeof testCase.scenario !== "string") {
    fail(errors, `${label}.scenario`, "must be a non-empty string");
  }
  if (!CAPABILITIES.has(testCase.capability)) {
    fail(errors, `${label}.capability`, "must be an AI-001 in-scope capability");
  }
  if (!CATEGORIES.has(testCase.category)) {
    fail(errors, `${label}.category`, `must be one of ${[...CATEGORIES].join(", ")}`);
  }
  if (!Array.isArray(testCase.securityTags) || testCase.securityTags.some((tag) => !SECURITY_TAGS.has(tag))) {
    fail(errors, `${label}.securityTags`, "must be an array of known security tags");
  }
  if (testCase.category === "security_adversarial" && (!Array.isArray(testCase.securityTags) || testCase.securityTags.length === 0)) {
    fail(errors, `${label}.securityTags`, "security_adversarial cases need at least one tag");
  }
  validateApproval(errors, label, testCase, catalog);

  const scoring = testCase.scoring;
  if (!isObject(scoring) || !CRITICALITIES.has(scoring.criticality) || !OUTCOMES.has(scoring.expectedPipelineOutcome) || !(scoring.caseWeight > 0)) {
    fail(errors, `${label}.scoring`, "requires caseWeight > 0, a known criticality and a known expectedPipelineOutcome");
    return;
  }
  if (Object.keys(scoring).some((key) => !["caseWeight", "criticality", "expectedPipelineOutcome"].includes(key))) {
    fail(errors, `${label}.scoring`, "only caseWeight, criticality and expectedPipelineOutcome are allowed (no cross-axis weights)");
  }

  if (!isObject(testCase.input)) {
    fail(errors, `${label}.input`, "must be an object");
    return;
  }
  if (!isObject(testCase.expected)) {
    fail(errors, `${label}.expected`, "must be an object");
    return;
  }
  const expected = testCase.expected;
  for (const key of ["requiredFacts", "allowedAlternatives", "allowedInferences", "mustRemainUnknown", "prohibitedOutputs"]) {
    if (!Array.isArray(expected[key])) {
      fail(errors, `${label}.expected.${key}`, "must be an array");
      return;
    }
  }

  const blocked = scoring.expectedPipelineOutcome === "payload_blocked";
  if (testCase.payloadExtras !== undefined) {
    if (testCase.category !== "security_adversarial") {
      fail(errors, `${label}.payloadExtras`, "only security_adversarial cases may carry payloadExtras");
    }
    if (!isObject(testCase.payloadExtras)) {
      fail(errors, `${label}.payloadExtras`, "must be an object");
    }
  }
  if (blocked) {
    const extras = isObject(testCase.payloadExtras) ? leafPaths(testCase.payloadExtras) : [];
    if (!extras.some((leaf) => blockedPaths.has(leaf))) {
      fail(errors, `${label}.payloadExtras`, "payload_blocked cases must carry at least one AI_BLOCKED policy path");
    }
    if (scoring.criticality !== "zero_tolerance") {
      fail(errors, `${label}.scoring.criticality`, "payload_blocked cases must be zero_tolerance");
    }
    if (expected.requiredFacts.length > 0 || testCase.provenanceExpectations?.length > 0) {
      fail(errors, label, "payload_blocked cases must not expect facts or provenance");
    }
    return;
  }

  if (expected.requiredFacts.length === 0 && expected.mustRemainUnknown.length === 0) {
    fail(errors, `${label}.expected`, "non-blocked cases need requiredFacts or mustRemainUnknown");
  }
  if (expected.requiredFacts.length === 0) {
    fail(errors, `${label}.expected.requiredFacts`, "an empty suggestion list is rejected by the pipeline, so each case needs at least one required fact");
  }
  validateFacts(errors, label, testCase.input, expected);
  validateProvenance(errors, label, testCase.input, expected, testCase.provenanceExpectations);

  if (!testCase.securityTags?.includes("guard_false_positive_probe") && allStrings(testCase.input).some((text) => SECRET_LIKE.test(text))) {
    fail(errors, `${label}.input`, "contains secret-like guard words but is not tagged guard_false_positive_probe");
  }
  if (testCase.securityTags?.includes("guard_false_positive_probe") && !allStrings(testCase.input).some((text) => SECRET_LIKE.test(text))) {
    fail(errors, `${label}.securityTags`, "guard_false_positive_probe case must contain a guard word");
  }
}

function validateV1Carryover(catalog, errors, v1) {
  const byId = new Map((catalog.cases || []).map((testCase) => [testCase.caseId, testCase]));
  for (const item of v1.items) {
    const carried = byId.get(item.id);
    if (!carried) {
      fail(errors, "$.cases", `v1 item ${item.id} is missing from v2`);
      continue;
    }
    if (carried.origin !== "v1") {
      fail(errors, `$.cases.${item.id}.origin`, "must be v1");
    }
    if (carried.sku !== item.sku || JSON.stringify(carried.input) !== JSON.stringify(item.input)) {
      fail(errors, `$.cases.${item.id}`, "sku and input must be identical to v1");
    }
    if (JSON.stringify(carried.expected?.requiredFacts) !== JSON.stringify(item.expected.requiredFacts)) {
      fail(errors, `$.cases.${item.id}.expected.requiredFacts`, "must be identical to v1");
    }
  }
}

function validateCatalog(catalog, options = {}) {
  const errors = [];
  if (!isObject(catalog)) {
    return { ok: false, errors: ["$: catalog must be an object"] };
  }
  if (catalog.catalogId !== "AI-EVAL-002-GOLDEN-CATALOG-V2") {
    fail(errors, "$.catalogId", "must be AI-EVAL-002-GOLDEN-CATALOG-V2");
  }
  if (catalog.version !== 2) {
    fail(errors, "$.version", "must be 2");
  }
  if (catalog.nonRuntime !== true) {
    fail(errors, "$.nonRuntime", "must be true");
  }
  if (catalog.owner !== "qa-ai-evaluation") {
    fail(errors, "$.owner", "must be qa-ai-evaluation");
  }
  validateAxes(catalog, errors);
  walkForForbiddenKeys(catalog, errors);

  if (!Array.isArray(catalog.cases) || catalog.cases.length === 0) {
    fail(errors, "$.cases", "must be a non-empty array");
    return { ok: false, errors };
  }
  if (!options.skipSizeBounds && (catalog.cases.length < MIN_CASES || catalog.cases.length > MAX_CASES)) {
    fail(errors, "$.cases", `must contain ${MIN_CASES}-${MAX_CASES} cases, got ${catalog.cases.length}`);
  }

  const blockedPaths = options.blockedPaths || blockedPolicyPaths();
  const ids = new Set();
  const skus = new Set();
  const tally = {};
  catalog.cases.forEach((testCase, index) => {
    if (isObject(testCase)) {
      if (ids.has(testCase.caseId)) {
        fail(errors, `$.cases[${index}].caseId`, `duplicate ${testCase.caseId}`);
      }
      ids.add(testCase.caseId);
      if (skus.has(testCase.sku)) {
        fail(errors, `$.cases[${index}].sku`, `duplicate ${testCase.sku}`);
      }
      skus.add(testCase.sku);
      tally[testCase.category] = (tally[testCase.category] || 0) + 1;
    }
    validateCase(testCase, index, catalog, blockedPaths, errors);
  });

  if (!options.skipSizeBounds) {
    for (const [category, minimum] of Object.entries(MIN_PER_CATEGORY)) {
      if ((tally[category] || 0) < minimum) {
        fail(errors, "$.cases", `category ${category} needs at least ${minimum} cases, got ${tally[category] || 0}`);
      }
    }
    validateV1Carryover(catalog, errors, options.v1 || readJson(V1_FIXTURE));
  }

  return { ok: errors.length === 0, errors, tally };
}

function runCli() {
  const catalog = readJson();
  const result = validateCatalog(catalog);
  if (!result.ok) {
    console.error("AI-EVAL-002a Golden Catalog v2 validation failed:");
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }
  const approved = catalog.cases.filter((testCase) => testCase.approvalStatus === "APPROVED").length;
  console.log(
    `AI-EVAL-002a Golden Catalog v2 validation passed: ${catalog.cases.length} cases (${approved} approved, ${catalog.cases.length - approved} draft), ${catalog.axes.length} independent axes.`,
  );
}

if (require.main === module) {
  runCli();
}

module.exports = {
  DEFAULT_FIXTURE,
  MIN_PER_CATEGORY,
  readJson,
  validateCatalog,
};
