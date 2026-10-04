#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_CONTRACT = path.resolve(
  __dirname,
  "..",
  "test-fixtures",
  "ai-gov",
  "review-workflow.v1.json",
);
const DEFAULT_CASES = path.resolve(
  __dirname,
  "..",
  "test-fixtures",
  "ai-gov",
  "review-workflow-cases.v1.json",
);

const REQUIRED_DECISIONS = new Set(["accept", "edit", "reject"]);
const REQUIRED_STATES = new Set([
  "pending_review",
  "accepted",
  "edited",
  "rejected",
  "blocked_stale",
  "blocked_tampered",
  "blocked_unauthorized",
]);
const REQUIRED_STORED_VALUES = new Set(["suggestedValue", "reviewDecision", "reviewedValue", "appliedValue"]);
const REQUIRED_IMMUTABLE_FIELDS = new Set([
  "suggestedValue",
  "evidence",
  "sourceVersion",
  "promptVersion",
  "schemaVersion",
  "generationFingerprint",
]);
const REQUIRED_REVIEWER_SURFACE = new Set([
  "sourceContext",
  "suggestedValue",
  "evidence",
  "validationState",
  "confidence",
  "freshnessState",
  "reviewDecisionHistory",
  "auditTrail",
]);
const REQUIRED_AUDIT_FIELDS = new Set([
  "tenant",
  "actor",
  "suggestionId",
  "capability",
  "decision",
  "previousLifecycleState",
  "newLifecycleState",
  "sourceVersion",
  "promptVersion",
  "schemaVersion",
  "evidenceHash",
]);
const REQUIRED_NEGATIVE_CASES = new Set([
  "accept_without_evidence",
  "edit_replaces_suggested_value",
  "accept_stale_suggestion",
  "accept_tampered_evidence",
  "direct_ai_canonical_write",
  "broadened_reviewer_catalog_write",
  "bulk_accept_without_per_suggestion_checks",
]);
const REQUIRED_CASES = new Set([
  "AI-GOV-001-ACCEPT-VALID",
  "AI-GOV-001-EDIT-VALID",
  "AI-GOV-001-REJECT-VALID",
  "AI-GOV-001-STALE-BLOCKED",
  "AI-GOV-001-TAMPERED-BLOCKED",
  "AI-GOV-001-UNAUTHORIZED-BLOCKED",
  "AI-GOV-001-TENANT-MISMATCH-BLOCKED",
  "AI-GOV-001-UNSUPPORTED-EVIDENCE-BLOCKED",
  "AI-GOV-001-APPLY-BOUNDARY",
]);
const REVIEWER_ROLE = "AI_SUGGESTION_REVIEWER";
const REVIEWER_SCOPE = "ai:suggestion:review";
const SECRET_VALUE_PATTERN = /\b(token|secret|credential|api[\s_-]?key|access[\s_-]?key|refresh[\s_-]?token|private[\s_-]?key|password)\b/i;

function readJson(filePath = DEFAULT_CONTRACT) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function fail(errors, pathLabel, message) {
  errors.push(`${pathLabel}: ${message}`);
}

function assertSetIncludes(errors, values, required, pathLabel) {
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

function validateDecision(errors, decision) {
  const base = `$.reviewDecisions.${decision.decision ?? "<missing>"}`;

  if (!REQUIRED_DECISIONS.has(decision.decision)) {
    fail(errors, base, "unsupported review decision");
    return;
  }
  if (decision.preservesSuggestedValue !== true) {
    fail(errors, `${base}.preservesSuggestedValue`, "must be true");
  }
  if (decision.requiresCurrentSuggestion !== false && decision.requiresCurrentSuggestion !== true) {
    fail(errors, `${base}.requiresCurrentSuggestion`, "must be boolean");
  }
  if (decision.canonicalWriteAllowed !== false) {
    fail(errors, `${base}.canonicalWriteAllowed`, "must be false");
  }

  if (decision.decision === "accept") {
    if (decision.requiresEvidence !== true) {
      fail(errors, `${base}.requiresEvidence`, "accept must require evidence");
    }
    if (decision.requiresCurrentSuggestion !== true) {
      fail(errors, `${base}.requiresCurrentSuggestion`, "accept must require a current suggestion");
    }
  }

  if (decision.decision === "edit") {
    if (decision.requiresReviewedValue !== true) {
      fail(errors, `${base}.requiresReviewedValue`, "edit must require reviewedValue");
    }
    if (decision.requiresEvidence !== true) {
      fail(errors, `${base}.requiresEvidence`, "edit must require evidence");
    }
    if (decision.requiresCurrentSuggestion !== true) {
      fail(errors, `${base}.requiresCurrentSuggestion`, "edit must require a current suggestion");
    }
  }

  if (decision.decision === "reject" && decision.requiresReason !== true) {
    fail(errors, `${base}.requiresReason`, "reject must require a reviewer reason");
  }
}

function validateReviewWorkflow(contract) {
  const errors = [];

  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    return { ok: false, errors: ["$: contract must be an object"] };
  }

  if (contract.contractId !== "AI-GOV-001-REVIEW-WORKFLOW-V1") {
    fail(errors, "$.contractId", "must be AI-GOV-001-REVIEW-WORKFLOW-V1");
  }
  if (contract.version !== 1) {
    fail(errors, "$.version", "must be 1");
  }
  if (contract.nonRuntime !== true) {
    fail(errors, "$.nonRuntime", "must be true");
  }
  if (contract.owner !== "po-ux-qa") {
    fail(errors, "$.owner", "must be po-ux-qa");
  }
  if (contract.gateStatus !== "blocked_until_gate_a_passes") {
    fail(errors, "$.gateStatus", "must remain blocked_until_gate_a_passes");
  }

  assertSetIncludes(errors, contract.valueModel?.requiredStoredValues, REQUIRED_STORED_VALUES, "$.valueModel.requiredStoredValues");
  assertSetIncludes(errors, contract.valueModel?.immutableFields, REQUIRED_IMMUTABLE_FIELDS, "$.valueModel.immutableFields");
  assertSetIncludes(errors, contract.reviewStates, REQUIRED_STATES, "$.reviewStates");
  assertSetIncludes(errors, contract.requiredReviewerSurface, REQUIRED_REVIEWER_SURFACE, "$.requiredReviewerSurface");
  assertSetIncludes(errors, contract.auditEvent?.requiredFields, REQUIRED_AUDIT_FIELDS, "$.auditEvent.requiredFields");
  assertSetIncludes(errors, contract.negativeCases, REQUIRED_NEGATIVE_CASES, "$.negativeCases");

  if (!Array.isArray(contract.reviewDecisions)) {
    fail(errors, "$.reviewDecisions", "must be an array");
  } else {
    const seen = new Set();
    for (const decision of contract.reviewDecisions) {
      validateDecision(errors, decision);
      if (decision?.decision) {
        seen.add(decision.decision);
      }
    }
    for (const decision of REQUIRED_DECISIONS) {
      if (!seen.has(decision)) {
        fail(errors, "$.reviewDecisions", `missing ${decision}`);
      }
    }
  }

  const guards = contract.staleTamperedGuards ?? {};
  for (const key of [
    "sourceVersionMustMatch",
    "promptVersionMustMatch",
    "schemaVersionMustMatch",
    "evidenceHashMustMatch",
    "tenantMustMatch",
    "capabilityMustMatch",
    "blockAcceptanceWhenStale",
    "blockAcceptanceWhenTampered",
  ]) {
    if (guards[key] !== true) {
      fail(errors, `$.staleTamperedGuards.${key}`, "must be true");
    }
  }

  const rbac = contract.rbac ?? {};
  assertSetIncludes(errors, rbac.reviewDecisionRoles, new Set(["admin", "approver", "reviewer"]), "$.rbac.reviewDecisionRoles");
  assertSetIncludes(errors, rbac.canonicalCatalogWriteRolesRemain, new Set(["admin", "editor"]), "$.rbac.canonicalCatalogWriteRolesRemain");
  if (JSON.stringify(rbac.canonicalCatalogWriteRolesRemain ?? []) !== JSON.stringify(["admin", "editor"])) {
    fail(errors, "$.rbac.canonicalCatalogWriteRolesRemain", "must remain exactly admin,editor");
  }
  if (rbac.mustNotBroadenCanonicalWriteAccess !== true) {
    fail(errors, "$.rbac.mustNotBroadenCanonicalWriteAccess", "must be true");
  }

  const mutationBoundary = contract.mutationBoundary ?? {};
  if (mutationBoundary.aiDirectCanonicalWriteAllowed !== false) {
    fail(errors, "$.mutationBoundary.aiDirectCanonicalWriteAllowed", "must be false");
  }
  if (mutationBoundary.controlledApplyPath !== "product_service_after_human_approval") {
    fail(errors, "$.mutationBoundary.controlledApplyPath", "must be product_service_after_human_approval");
  }
  if (mutationBoundary.applyRequiresDeterministicValidation !== true) {
    fail(errors, "$.mutationBoundary.applyRequiresDeterministicValidation", "must be true");
  }
  if (mutationBoundary.applyRequiresAuditEvent !== true) {
    fail(errors, "$.mutationBoundary.applyRequiresAuditEvent", "must be true");
  }

  const bulkReview = contract.bulkReview ?? {};
  if (bulkReview.status !== "deferred_until_workflow_valid") {
    fail(errors, "$.bulkReview.status", "must be deferred_until_workflow_valid");
  }
  for (const key of [
    "requiresPerSuggestionEvidence",
    "requiresPerSuggestionStaleTamperedChecks",
    "requiresReviewerBurdenAssessment",
    "cannotBypassProductServiceValidation",
    "partialFailureBehaviorRequired",
  ]) {
    if (bulkReview[key] !== true) {
      fail(errors, `$.bulkReview.${key}`, "must be true");
    }
  }

  return { ok: errors.length === 0, errors };
}

function validateFixture(fixture, index, errors) {
  const base = `$.fixtures[${index}]`;
  const isBlocked = String(fixture.expectedOutcome ?? "").startsWith("blocked");
  const isApplyBoundary = fixture.expectedOutcome === "valid_product_service_apply_reference_only";
  const sourceChanged =
    fixture.sourceVersion !== fixture.currentSourceVersion || fixture.sourceHash !== fixture.currentSourceHash;
  const payloadTampered = fixture.generatedPayloadHash !== fixture.serverGeneratedPayloadHash;
  const tenantMismatch = fixture.tenantId !== fixture.actorTenantId;
  const hasReviewerAuth =
    Array.isArray(fixture.reviewer?.roles) &&
    fixture.reviewer.roles.includes(REVIEWER_ROLE) &&
    Array.isArray(fixture.reviewer?.scopes) &&
    fixture.reviewer.scopes.includes(REVIEWER_SCOPE);
  const hasProvenance = Boolean(fixture.provenance?.sourceField && fixture.provenance?.citation);
  const validationPassed = fixture.validation?.status === "passed";

  for (const field of [
    "fixtureId",
    "tenantId",
    "actorTenantId",
    "entityType",
    "entityId",
    "sourceRecordId",
    "promptVersion",
    "schemaVersion",
    "generatedPayloadHash",
    "serverGeneratedPayloadHash",
    "suggestedValue",
    "reviewDecision",
    "expectedOutcome",
  ]) {
    if (fixture[field] === undefined || fixture[field] === null || fixture[field] === "") {
      fail(errors, `${base}.${field}`, "is required");
    }
  }

  if (fixture.canonicalProductPatch !== null) {
    fail(errors, `${base}.canonicalProductPatch`, "review fixture must not include a direct canonical product patch");
  }

  if (!fixture.audit?.generationEventId) {
    fail(errors, `${base}.audit.generationEventId`, "is required");
  }

  if ((fixture.reviewDecision === "accepted" || fixture.reviewDecision === "edited" || fixture.reviewDecision === "rejected") && !fixture.audit?.reviewEventId) {
    fail(errors, `${base}.audit.reviewEventId`, "is required for review decisions");
  }

  if (!isApplyBoundary && fixture.audit?.applyEventId) {
    fail(errors, `${base}.audit.applyEventId`, "is only allowed for Product Service apply boundary fixtures");
  }

  if (fixture.reviewDecision === "accepted") {
    if (fixture.reviewedValue !== fixture.suggestedValue) {
      fail(errors, `${base}.reviewedValue`, "accepted suggestions must keep reviewedValue equal to suggestedValue");
    }
    if (!hasProvenance || !validationPassed || sourceChanged || payloadTampered || tenantMismatch || !hasReviewerAuth) {
      fail(errors, base, "accepted fixture bypasses required evidence, freshness, tenant, auth, or validation checks");
    }
  }

  if (fixture.reviewDecision === "edited") {
    if (!fixture.reviewedValue || fixture.reviewedValue === fixture.suggestedValue) {
      fail(errors, `${base}.reviewedValue`, "edited suggestions must preserve suggestedValue and store a distinct reviewedValue");
    }
    if (!fixture.editReason) {
      fail(errors, `${base}.editReason`, "is required for edited suggestions");
    }
  }

  if (fixture.reviewDecision === "rejected") {
    if (!fixture.rejectReason) {
      fail(errors, `${base}.rejectReason`, "is required for rejected suggestions");
    }
    if (fixture.reviewedValue !== null || fixture.appliedValue !== null || fixture.audit?.applyEventId !== null) {
      fail(errors, base, "rejected suggestions must not include reviewedValue, appliedValue, or apply audit");
    }
  }

  if (sourceChanged && fixture.reviewDecision !== "blocked_stale") {
    fail(errors, `${base}.reviewDecision`, "source mismatch must be blocked_stale");
  }
  if (payloadTampered && fixture.reviewDecision !== "blocked_tampered") {
    fail(errors, `${base}.reviewDecision`, "payload hash mismatch must be blocked_tampered");
  }
  if ((tenantMismatch || !hasReviewerAuth) && fixture.reviewDecision !== "blocked_unauthorized") {
    fail(errors, `${base}.reviewDecision`, "tenant/auth mismatch must be blocked_unauthorized");
  }
  if ((!hasProvenance || !validationPassed) && !isBlocked) {
    fail(errors, base, "missing provenance or failed validation must not enter normal review");
  }
  if (isBlocked && (fixture.appliedValue !== null || fixture.audit?.applyEventId !== null)) {
    fail(errors, base, "blocked fixtures must not apply");
  }

  for (const entry of flattenStrings(fixture, base)) {
    if (SECRET_VALUE_PATTERN.test(entry.value)) {
      fail(errors, entry.path, "fixture contains secret-like text");
    }
  }
}

function validateReviewFixtures(caseSet) {
  const errors = [];
  if (!caseSet || typeof caseSet !== "object" || Array.isArray(caseSet)) {
    return { ok: false, errors: ["$: fixture set must be an object"] };
  }
  if (caseSet.fixtureSetId !== "AI-GOV-001-REVIEW-WORKFLOW-CASES-V1") {
    fail(errors, "$.fixtureSetId", "must be AI-GOV-001-REVIEW-WORKFLOW-CASES-V1");
  }
  if (caseSet.version !== 1) {
    fail(errors, "$.version", "must be 1");
  }
  if (caseSet.nonRuntime !== true) {
    fail(errors, "$.nonRuntime", "must be true");
  }
  if (!Array.isArray(caseSet.fixtures)) {
    fail(errors, "$.fixtures", "must be an array");
  } else {
    const seen = new Set();
    caseSet.fixtures.forEach((fixture, index) => {
      if (fixture?.fixtureId) {
        seen.add(fixture.fixtureId);
      }
      validateFixture(fixture, index, errors);
    });
    for (const fixtureId of REQUIRED_CASES) {
      if (!seen.has(fixtureId)) {
        fail(errors, "$.fixtures", `missing ${fixtureId}`);
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

function runCli() {
  const contract = readJson();
  const cases = readJson(DEFAULT_CASES);
  const result = validateReviewWorkflow(contract);
  const caseResult = validateReviewFixtures(cases);
  if (!result.ok || !caseResult.ok) {
    console.error("AI-GOV-001 review workflow validation failed:");
    for (const error of [...result.errors, ...caseResult.errors]) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(
    `AI-GOV-001 review workflow validation passed: ${contract.reviewDecisions.length} decisions, ${cases.fixtures.length} fixtures, ${contract.negativeCases.length} negative cases.`,
  );
}

if (require.main === module) {
  runCli();
}

module.exports = {
  DEFAULT_CONTRACT,
  DEFAULT_CASES,
  REQUIRED_DECISIONS,
  readJson,
  validateReviewFixtures,
  validateReviewWorkflow,
};
