#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_CONTRACT = path.resolve(
  __dirname,
  "..",
  "test-fixtures",
  "ai-core",
  "suggestion-provenance.v1.json",
);

const REQUIRED_IDENTITY_FIELDS = new Set([
  "suggestionId",
  "executionId",
  "tenantKey",
  "entityType",
  "entityId",
  "capability",
  "fieldPath",
  "sourceRecordId",
  "sourceVersion",
  "sourceHash",
  "promptVersion",
  "schemaVersion",
  "generationFingerprint",
  "idempotencyFingerprint",
]);
const REQUIRED_IMMUTABLE_FIELDS = new Set([
  "suggestedValue",
  "suggestedValueHash",
  "generatedPayload",
  "generatedPayloadHash",
  "confidence",
  "evidence",
  "sourceVersion",
  "sourceHash",
  "promptVersion",
  "schemaVersion",
  "generationFingerprint",
  "idempotencyFingerprint",
]);
const REQUIRED_GENERATION_FINGERPRINT_FIELDS = new Set([
  "tenantKey",
  "capability",
  "entityType",
  "entityId",
  "fieldPath",
  "sourceVersion",
  "sourceHash",
  "promptVersion",
  "schemaVersion",
  "generatedPayloadHash",
]);
const REQUIRED_IDEMPOTENCY_FIELDS = new Set([
  "tenantKey",
  "capability",
  "entityType",
  "entityId",
  "fieldPath",
  "sourceVersion",
  "sourceHash",
  "promptVersion",
  "schemaVersion",
  "generationFingerprint",
]);
const REQUIRED_REVIEW_FIELDS = new Set(["reviewDecision", "reviewedValue", "reviewedValueHash", "reviewedBy", "reviewedAt", "reviewReason"]);
const REQUIRED_APPLY_FIELDS = new Set(["appliedValue", "appliedValueHash", "appliedAt", "productServiceApplyTransactionId"]);
const REQUIRED_EVIDENCE_FIELDS = new Set(["sourceField", "sourceRecordId", "sourceVersion", "sourceHash", "citation", "evidenceHash"]);
const REQUIRED_EVALUATION_DIMENSIONS = new Set([
  "attributeFamily",
  "evidenceCoverage",
  "acceptedWithoutEdit",
  "correctedByReviewer",
  "rejectedByReviewer",
  "blockedStaleOrTampered",
  "correctionDelta",
]);
const REQUIRED_STATES = new Set([
  "generated",
  "pending_review",
  "accepted",
  "edited",
  "rejected",
  "blocked_stale",
  "blocked_tampered",
  "blocked_unauthorized",
  "applied",
]);
const REVIEWER_ROLE = "AI_SUGGESTION_REVIEWER";
const REVIEWER_SCOPE = "ai:suggestion:review";
const SECRET_VALUE_PATTERN = /(sk-[a-z0-9]|bearer\s+[a-z0-9]|oauth|private[\s_-]?key|webhook[\s_-]?secret|api[\s_-]?key|password|credential|secret)/i;
const FORBIDDEN_RUNTIME_EFFECT_KEYS = new Set([
  "directProductPatch",
  "canonicalProductPatch",
  "productUpdate",
  "productServiceMutation",
  "providerCall",
  "schemaMigration",
]);

function readJson(filePath = DEFAULT_CONTRACT) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function fail(errors, pathLabel, message) {
  errors.push(`${pathLabel}: ${message}`);
}

function assertIncludes(errors, values, required, pathLabel) {
  if (!Array.isArray(values)) {
    fail(errors, pathLabel, "must be an array");
    return;
  }
  for (const value of required) {
    if (!values.includes(value)) {
      fail(errors, pathLabel, `missing ${value}`);
    }
  }
}

function flattenStrings(value, prefix = "$", out = []) {
  if (typeof value === "string") {
    out.push({ path: prefix, value });
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => flattenStrings(entry, `${prefix}[${index}]`, out));
    return out;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      flattenStrings(child, `${prefix}.${key}`, out);
    }
  }
  return out;
}

function walkKeys(value, prefix = "$", out = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkKeys(entry, `${prefix}[${index}]`, out));
    return out;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      out.push({ path: `${prefix}.${key}`, key });
      walkKeys(child, `${prefix}.${key}`, out);
    }
  }
  return out;
}

function hasReviewerAuth(example) {
  return (
    Array.isArray(example.reviewer?.roles) &&
    example.reviewer.roles.includes(REVIEWER_ROLE) &&
    Array.isArray(example.reviewer?.scopes) &&
    example.reviewer.scopes.includes(REVIEWER_SCOPE)
  );
}

function validateEvidence(example, index, errors) {
  const base = `$.examples[${index}]`;
  if (example.requiresEvidence !== true) {
    return;
  }
  if (!Array.isArray(example.evidence) || example.evidence.length === 0) {
    fail(errors, `${base}.evidence`, "factual suggestions must include evidence");
    return;
  }
  for (const [evidenceIndex, evidence] of example.evidence.entries()) {
    const evidenceBase = `${base}.evidence[${evidenceIndex}]`;
    for (const field of REQUIRED_EVIDENCE_FIELDS) {
      if (evidence[field] === undefined || evidence[field] === null || evidence[field] === "") {
        fail(errors, `${evidenceBase}.${field}`, "is required");
      }
    }
    if (evidence.sourceRecordId !== example.sourceRecordId) {
      fail(errors, `${evidenceBase}.sourceRecordId`, "must match suggestion sourceRecordId");
    }
    if (evidence.sourceVersion !== example.sourceVersion || evidence.sourceHash !== example.sourceHash) {
      fail(errors, evidenceBase, "must match generation source version/hash");
    }
    if (evidence.evidenceHash !== evidence.serverEvidenceHash) {
      fail(errors, `${evidenceBase}.evidenceHash`, "must match serverEvidenceHash");
    }
  }
}

function validateExample(example, index, errors, states) {
  const base = `$.examples[${index}]`;
  for (const field of REQUIRED_IDENTITY_FIELDS) {
    if (example[field] === undefined || example[field] === null || example[field] === "") {
      fail(errors, `${base}.${field}`, "is required");
    }
  }
  if (!states.has(example.lifecycleState)) {
    fail(errors, `${base}.lifecycleState`, "must be a declared lifecycle state");
  }
  if (example.actorTenantKey !== example.tenantKey && example.lifecycleState !== "blocked_unauthorized") {
    fail(errors, `${base}.lifecycleState`, "tenant mismatch must be blocked_unauthorized");
  }
  if (!hasReviewerAuth(example) && !["generated", "pending_review", "blocked_unauthorized"].includes(example.lifecycleState)) {
    fail(errors, `${base}.reviewer`, "reviewed suggestions require reviewer role and scope");
  }
  if (example.currentSourceVersion !== example.sourceVersion || example.currentSourceHash !== example.sourceHash) {
    if (example.lifecycleState !== "blocked_stale") {
      fail(errors, `${base}.lifecycleState`, "source version/hash mismatch must be blocked_stale");
    }
  }
  if (example.generatedPayloadHash !== example.serverGeneratedPayloadHash && example.lifecycleState !== "blocked_tampered") {
    fail(errors, `${base}.lifecycleState`, "generated payload hash mismatch must be blocked_tampered");
  }

  validateEvidence(example, index, errors);

  for (const entry of walkKeys(example, base)) {
    if (FORBIDDEN_RUNTIME_EFFECT_KEYS.has(entry.key)) {
      fail(errors, entry.path, "direct Product/provider/runtime effect fields are forbidden in suggestion fixtures");
    }
  }

  if (example.reviewDecision === "accept") {
    if (example.reviewedValue !== example.suggestedValue || example.reviewedValueHash !== example.suggestedValueHash) {
      fail(errors, `${base}.reviewedValue`, "accepted suggestions must keep reviewed value equal to immutable suggested value");
    }
  }
  if (example.reviewDecision === "edit") {
    if (!example.reviewedValue || example.reviewedValue === example.suggestedValue) {
      fail(errors, `${base}.reviewedValue`, "edited suggestions must store a distinct reviewed value");
    }
    if (!example.reviewReason) {
      fail(errors, `${base}.reviewReason`, "edited suggestions require reviewReason");
    }
    if (example.suggestedValueHash === example.reviewedValueHash) {
      fail(errors, `${base}.reviewedValueHash`, "edited suggestions must not overwrite suggestedValueHash");
    }
  }
  if (example.reviewDecision === "reject") {
    if (!example.reviewReason) {
      fail(errors, `${base}.reviewReason`, "rejected suggestions require reviewReason");
    }
    if (example.reviewedValue !== null || example.appliedValue !== null) {
      fail(errors, base, "rejected suggestions must not include reviewedValue or appliedValue");
    }
  }

  if (["accepted", "edited", "rejected"].includes(example.lifecycleState)) {
    if (!example.reviewedBy || !example.reviewedAt) {
      fail(errors, base, "reviewed lifecycle states require reviewedBy and reviewedAt");
    }
    if (!Array.isArray(example.auditEventIds) || example.auditEventIds.length < 2) {
      fail(errors, `${base}.auditEventIds`, "reviewed suggestions require generation and review audit events");
    }
  }
  if (example.lifecycleState === "applied") {
    if (!example.productServiceApplyTransactionId || !example.appliedAt || example.appliedValue === null) {
      fail(errors, base, "applied suggestions must reference Product Service apply transaction");
    }
    if (!Array.isArray(example.auditEventIds) || example.auditEventIds.length < 3) {
      fail(errors, `${base}.auditEventIds`, "applied suggestions require generation, review, and apply audit events");
    }
  } else if (example.productServiceApplyTransactionId !== null || example.appliedValue !== null || example.appliedAt !== null) {
    fail(errors, base, "non-applied suggestions must not contain apply values");
  }

  if (!example.evaluation || typeof example.evaluation !== "object") {
    fail(errors, `${base}.evaluation`, "is required");
  } else {
    if (example.evaluation.evidenceCoverage !== 1 && example.requiresEvidence === true) {
      fail(errors, `${base}.evaluation.evidenceCoverage`, "must be 1 for valid factual suggestion examples");
    }
    if (example.reviewDecision === "edit" && !example.evaluation.correctedByReviewer) {
      fail(errors, `${base}.evaluation.correctedByReviewer`, "must be true for edit decisions");
    }
    if (example.reviewDecision === "reject" && !example.evaluation.rejectedByReviewer) {
      fail(errors, `${base}.evaluation.rejectedByReviewer`, "must be true for reject decisions");
    }
  }

  for (const entry of flattenStrings(example, base)) {
    if (SECRET_VALUE_PATTERN.test(entry.value)) {
      fail(errors, entry.path, "must not contain secret-like text");
    }
  }
}

function validateSuggestionProvenance(contract) {
  const errors = [];
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    return { ok: false, errors: ["$: contract must be an object"] };
  }
  if (contract.contractId !== "AI-CORE-003-SUGGESTION-PROVENANCE-V1") {
    fail(errors, "$.contractId", "must be AI-CORE-003-SUGGESTION-PROVENANCE-V1");
  }
  if (contract.version !== 1) {
    fail(errors, "$.version", "must be 1");
  }
  if (contract.nonRuntime !== true) {
    fail(errors, "$.nonRuntime", "must be true");
  }
  if (contract.owner !== "backend-qa-pim-sme") {
    fail(errors, "$.owner", "must be backend-qa-pim-sme");
  }
  if (contract.gateStatus !== "blocked_until_gate_a_passes") {
    fail(errors, "$.gateStatus", "must remain blocked_until_gate_a_passes");
  }
  if (contract.invariant !== "generated_suggestion_is_immutable_review_and_apply_values_are_separate") {
    fail(errors, "$.invariant", "must preserve generated suggestion immutability");
  }

  assertIncludes(errors, contract.identityFields, REQUIRED_IDENTITY_FIELDS, "$.identityFields");
  assertIncludes(errors, contract.immutableGeneratedFields, REQUIRED_IMMUTABLE_FIELDS, "$.immutableGeneratedFields");
  assertIncludes(errors, contract.generationFingerprintFields, REQUIRED_GENERATION_FINGERPRINT_FIELDS, "$.generationFingerprintFields");
  assertIncludes(errors, contract.idempotencyFields, REQUIRED_IDEMPOTENCY_FIELDS, "$.idempotencyFields");
  assertIncludes(errors, contract.reviewFields, REQUIRED_REVIEW_FIELDS, "$.reviewFields");
  assertIncludes(errors, contract.applyFields, REQUIRED_APPLY_FIELDS, "$.applyFields");
  assertIncludes(errors, contract.requiredEvidenceFields, REQUIRED_EVIDENCE_FIELDS, "$.requiredEvidenceFields");
  assertIncludes(errors, contract.evaluationDimensions, REQUIRED_EVALUATION_DIMENSIONS, "$.evaluationDimensions");
  assertIncludes(errors, contract.lifecycleStates, REQUIRED_STATES, "$.lifecycleStates");
  assertIncludes(errors, contract.forbiddenRuntimeEffects, FORBIDDEN_RUNTIME_EFFECT_KEYS, "$.forbiddenRuntimeEffects");

  const states = new Set(contract.lifecycleStates ?? []);
  if (!Array.isArray(contract.examples) || contract.examples.length < 6) {
    fail(errors, "$.examples", "must include accept, edit, reject, stale, tampered, and apply examples");
  } else {
    contract.examples.forEach((example, index) => validateExample(example, index, errors, states));
    const exampleIds = new Set(contract.examples.map((example) => example.exampleId));
    for (const id of [
      "AI-CORE-003-ACCEPT-FACTUAL",
      "AI-CORE-003-EDIT-FACTUAL",
      "AI-CORE-003-REJECT-FACTUAL",
      "AI-CORE-003-STALE-BLOCKED",
      "AI-CORE-003-TAMPERED-BLOCKED",
      "AI-CORE-003-APPLY-REFERENCE",
    ]) {
      if (!exampleIds.has(id)) {
        fail(errors, "$.examples", `missing ${id}`);
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

function runCli() {
  const contract = readJson();
  const result = validateSuggestionProvenance(contract);
  if (!result.ok) {
    console.error("AI-CORE-003 suggestion provenance validation failed:");
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(
    `AI-CORE-003 suggestion provenance validation passed: ${contract.examples.length} examples, ${contract.immutableGeneratedFields.length} immutable fields.`,
  );
}

if (require.main === module) {
  runCli();
}

module.exports = {
  DEFAULT_CONTRACT,
  readJson,
  validateSuggestionProvenance,
};
