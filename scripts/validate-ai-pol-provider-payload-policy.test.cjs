#!/usr/bin/env node

const assert = require("node:assert/strict");

const {
  readJson,
  validatePayloadAgainstPolicy,
  validatePolicy,
} = require("./validate-ai-pol-provider-payload-policy.cjs");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertInvalidPolicy(policy, expectedMessage) {
  const result = validatePolicy(policy);
  assert.equal(result.ok, false, "policy should be invalid");
  assert(
    result.errors.some((error) => error.includes(expectedMessage)),
    `expected error including "${expectedMessage}", got:\n${result.errors.join("\n")}`,
  );
}

function assertInvalidPayload(policy, payload, expectedMessage) {
  const result = validatePayloadAgainstPolicy(policy, payload);
  assert.equal(result.ok, false, "payload should be invalid");
  assert(
    result.errors.some((error) => error.includes(expectedMessage)),
    `expected error including "${expectedMessage}", got:\n${result.errors.join("\n")}`,
  );
}

const validPolicy = readJson();

{
  const result = validatePolicy(validPolicy);
  assert.equal(result.ok, true, result.errors.join("\n"));
}

{
  const policy = clone(validPolicy);
  policy.fields[1].path = policy.fields[0].path;
  assertInvalidPolicy(policy, "duplicate path");
}

{
  const policy = clone(validPolicy);
  policy.fields[0].classification = "AI_UNKNOWN";
  assertInvalidPolicy(policy, "supported AI classification");
}

{
  const policy = clone(validPolicy);
  policy.fields = policy.fields.filter((field) => field.classification !== "AI_BLOCKED");
  assertInvalidPolicy(policy, "AI_BLOCKED");
}

{
  const policy = clone(validPolicy);
  const redactedField = policy.fields.find((field) => field.classification === "AI_ALLOWED_WITH_REDACTION");
  delete redactedField.redaction;
  assertInvalidPolicy(policy, "redaction evidence");
}

{
  assertInvalidPayload(validPolicy, { connector: { accessToken: "opaque" } }, "AI_BLOCKED field");
}

{
  assertInvalidPayload(validPolicy, { supplier: { contactEmail: "supplier@example.invalid" } }, "redactedFields evidence");
}

{
  assertInvalidPayload(
    validPolicy,
    {
      supplier: { contactEmail: "supplier@example.invalid" },
      redactedFields: ["supplier.contactEmail"],
    },
    "email-like value is not redacted",
  );
}

{
  assertInvalidPayload(validPolicy, { product: { internalNotes: "contains token abc123" }, redactedFields: ["product.internalNotes"] }, "secret-like text");
}

{
  const payload = clone(validPolicy.providerPayloadExamples[0].payload);
  const result = validatePayloadAgainstPolicy(validPolicy, payload);
  assert.equal(result.ok, true, result.errors.join("\n"));
}

console.log("AI-POL-001 provider payload policy validator tests passed.");
