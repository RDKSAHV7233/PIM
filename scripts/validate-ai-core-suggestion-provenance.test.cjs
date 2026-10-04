#!/usr/bin/env node

const assert = require("node:assert/strict");
const { readJson, validateSuggestionProvenance } = require("./validate-ai-core-suggestion-provenance.cjs");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function expectInvalid(name, mutate, expectedSnippet) {
  const contract = clone(baseContract);
  mutate(contract);
  const result = validateSuggestionProvenance(contract);
  assert.equal(result.ok, false, `${name} unexpectedly passed validation`);
  assert(
    result.errors.some((error) => error.includes(expectedSnippet)),
    `${name} did not include expected error snippet "${expectedSnippet}". Errors: ${result.errors.join("; ")}`,
  );
}

const baseContract = readJson();
const validResult = validateSuggestionProvenance(baseContract);
assert.equal(validResult.ok, true, `valid fixture failed: ${validResult.errors.join("; ")}`);

expectInvalid(
  "suggested value no longer immutable",
  (contract) => {
    contract.immutableGeneratedFields = contract.immutableGeneratedFields.filter((field) => field !== "suggestedValue");
  },
  "missing suggestedValue",
);

expectInvalid(
  "accept changes reviewed value",
  (contract) => {
    contract.examples.find((example) => example.exampleId === "AI-CORE-003-ACCEPT-FACTUAL").reviewedValue = "Polyester";
  },
  "reviewed value equal",
);

expectInvalid(
  "edit overwrites suggested value hash",
  (contract) => {
    const example = contract.examples.find((entry) => entry.exampleId === "AI-CORE-003-EDIT-FACTUAL");
    example.reviewedValueHash = example.suggestedValueHash;
  },
  "must not overwrite suggestedValueHash",
);

expectInvalid(
  "missing factual evidence",
  (contract) => {
    contract.examples.find((example) => example.exampleId === "AI-CORE-003-ACCEPT-FACTUAL").evidence = [];
  },
  "factual suggestions must include evidence",
);

expectInvalid(
  "stale suggestion accepted",
  (contract) => {
    const example = contract.examples.find((entry) => entry.exampleId === "AI-CORE-003-STALE-BLOCKED");
    example.lifecycleState = "accepted";
    example.reviewDecision = "accept";
    example.reviewedValue = example.suggestedValue;
    example.reviewedValueHash = example.suggestedValueHash;
    example.reviewedBy = "user-reviewer-4";
    example.reviewedAt = "2026-10-04T11:20:00.000Z";
    example.auditEventIds.push("audit-suggestion-reviewed-004");
  },
  "source version/hash mismatch must be blocked_stale",
);

expectInvalid(
  "tampered payload accepted",
  (contract) => {
    const example = contract.examples.find((entry) => entry.exampleId === "AI-CORE-003-TAMPERED-BLOCKED");
    example.lifecycleState = "accepted";
    example.reviewDecision = "accept";
    example.reviewedValue = example.suggestedValue;
    example.reviewedValueHash = example.suggestedValueHash;
    example.reviewedBy = "user-reviewer-5";
    example.reviewedAt = "2026-10-04T11:25:00.000Z";
    example.auditEventIds.push("audit-suggestion-reviewed-005");
  },
  "generated payload hash mismatch must be blocked_tampered",
);

expectInvalid(
  "non-applied suggestion contains apply transaction",
  (contract) => {
    contract.examples.find((example) => example.exampleId === "AI-CORE-003-ACCEPT-FACTUAL").productServiceApplyTransactionId =
      "ps-apply-invalid";
  },
  "non-applied suggestions must not contain apply values",
);

expectInvalid(
  "direct product patch present",
  (contract) => {
    contract.examples.find((example) => example.exampleId === "AI-CORE-003-ACCEPT-FACTUAL").canonicalProductPatch = {
      attributes: { material: "Cotton" },
    };
  },
  "direct Product/provider/runtime effect fields are forbidden",
);

expectInvalid(
  "idempotency omits schema version",
  (contract) => {
    contract.idempotencyFields = contract.idempotencyFields.filter((field) => field !== "schemaVersion");
  },
  "missing schemaVersion",
);

expectInvalid(
  "reject includes reviewed value",
  (contract) => {
    contract.examples.find((example) => example.exampleId === "AI-CORE-003-REJECT-FACTUAL").reviewedValue = "Blue";
  },
  "rejected suggestions must not include reviewedValue",
);

console.log("AI-CORE-003 suggestion provenance validator tests passed.");
