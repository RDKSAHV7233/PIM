#!/usr/bin/env node

const assert = require("node:assert/strict");
const {
  DEFAULT_CASES,
  readJson,
  validateReviewFixtures,
  validateReviewWorkflow,
} = require("./validate-ai-gov-review-workflow.cjs");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function expectInvalid(name, mutate, expectedSnippet) {
  const contract = clone(baseContract);
  mutate(contract);
  const result = validateReviewWorkflow(contract);
  assert.equal(result.ok, false, `${name} unexpectedly passed validation`);
  assert(
    result.errors.some((error) => error.includes(expectedSnippet)),
    `${name} did not include expected error snippet "${expectedSnippet}". Errors: ${result.errors.join("; ")}`,
  );
}

const baseContract = readJson();
const baseCases = readJson(DEFAULT_CASES);
const validResult = validateReviewWorkflow(baseContract);
assert.equal(validResult.ok, true, `valid fixture failed: ${validResult.errors.join("; ")}`);
const validCasesResult = validateReviewFixtures(baseCases);
assert.equal(validCasesResult.ok, true, `valid cases failed: ${validCasesResult.errors.join("; ")}`);

expectInvalid(
  "suggested value can be modified",
  (contract) => {
    contract.valueModel.immutableFields = contract.valueModel.immutableFields.filter((field) => field !== "suggestedValue");
  },
  "missing suggestedValue",
);

expectInvalid(
  "accept without evidence",
  (contract) => {
    contract.reviewDecisions.find((decision) => decision.decision === "accept").requiresEvidence = false;
  },
  "accept must require evidence",
);

expectInvalid(
  "edit does not require reviewed value",
  (contract) => {
    contract.reviewDecisions.find((decision) => decision.decision === "edit").requiresReviewedValue = false;
  },
  "edit must require reviewedValue",
);

expectInvalid(
  "accept stale suggestion",
  (contract) => {
    contract.staleTamperedGuards.blockAcceptanceWhenStale = false;
  },
  "must be true",
);

expectInvalid(
  "direct AI write allowed",
  (contract) => {
    contract.mutationBoundary.aiDirectCanonicalWriteAllowed = true;
  },
  "must be false",
);

expectInvalid(
  "broaden canonical write access",
  (contract) => {
    contract.rbac.canonicalCatalogWriteRolesRemain.push("reviewer");
    contract.rbac.mustNotBroadenCanonicalWriteAccess = false;
  },
  "must be true",
);

expectInvalid(
  "bulk review bypasses per-suggestion checks",
  (contract) => {
    contract.bulkReview.requiresPerSuggestionStaleTamperedChecks = false;
  },
  "must be true",
);

function expectInvalidCases(name, mutate, expectedSnippet) {
  const cases = clone(baseCases);
  mutate(cases);
  const result = validateReviewFixtures(cases);
  assert.equal(result.ok, false, `${name} unexpectedly passed validation`);
  assert(
    result.errors.some((error) => error.includes(expectedSnippet)),
    `${name} did not include expected error snippet "${expectedSnippet}". Errors: ${result.errors.join("; ")}`,
  );
}

expectInvalidCases(
  "accepted reviewed value differs",
  (cases) => {
    cases.fixtures.find((fixture) => fixture.fixtureId === "AI-GOV-001-ACCEPT-VALID").reviewedValue = "Polyester";
  },
  "accepted suggestions must keep reviewedValue equal to suggestedValue",
);

expectInvalidCases(
  "edited suggestion replaces correction evidence",
  (cases) => {
    const fixture = cases.fixtures.find((entry) => entry.fixtureId === "AI-GOV-001-EDIT-VALID");
    fixture.reviewedValue = fixture.suggestedValue;
  },
  "distinct reviewedValue",
);

expectInvalidCases(
  "stale suggestion accepted",
  (cases) => {
    const fixture = cases.fixtures.find((entry) => entry.fixtureId === "AI-GOV-001-STALE-BLOCKED");
    fixture.reviewDecision = "accepted";
    fixture.reviewedValue = fixture.suggestedValue;
    fixture.audit.reviewEventId = "audit-review-stale-invalid";
  },
  "source mismatch must be blocked_stale",
);

expectInvalidCases(
  "tampered suggestion accepted",
  (cases) => {
    const fixture = cases.fixtures.find((entry) => entry.fixtureId === "AI-GOV-001-TAMPERED-BLOCKED");
    fixture.reviewDecision = "accepted";
    fixture.reviewedValue = fixture.suggestedValue;
    fixture.audit.reviewEventId = "audit-review-tampered-invalid";
  },
  "payload hash mismatch must be blocked_tampered",
);

expectInvalidCases(
  "direct canonical patch during review",
  (cases) => {
    cases.fixtures.find((fixture) => fixture.fixtureId === "AI-GOV-001-ACCEPT-VALID").canonicalProductPatch = {
      attributes: { material: "Cotton" },
    };
  },
  "direct canonical product patch",
);

expectInvalidCases(
  "secret-like text in fixture",
  (cases) => {
    cases.fixtures.find((fixture) => fixture.fixtureId === "AI-GOV-001-ACCEPT-VALID").generatedPayload.note =
      "api key removed";
  },
  "secret-like text",
);

console.log("AI-GOV-001 review workflow validator tests passed.");
