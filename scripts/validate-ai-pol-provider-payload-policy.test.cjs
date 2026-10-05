#!/usr/bin/env node

const assert = require("node:assert/strict");

const {
  SECRET_VECTORS_PATH,
  VECTORS_PATH,
  blockedLeaves,
  readJson,
  validatePathSemanticsVectors,
  validatePayloadAgainstPolicy,
  validatePolicy,
  validateSecretDetectionVectors,
  detectCredentialShapes,
  hasCredentialShape,
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


// ---- AI-POL-002: explicit path semantics ----

const vectors = readJson(VECTORS_PATH);

{
  const result = validatePathSemanticsVectors(vectors);
  assert.equal(result.ok, true, result.errors.join(String.fromCharCode(10)));
}

{
  // The vectors must be able to fail: a wrong expectation is detected.
  const broken = clone(vectors);
  broken.resolution[0].effective = "AI_BLOCKED";
  assert.equal(validatePathSemanticsVectors(broken).ok, false);
  const wrongGrammar = clone(vectors);
  wrongGrammar.ruleGrammar.invalid.push("product.title");
  assert.equal(validatePathSemanticsVectors(wrongGrammar).ok, false);
  const wrongKey = clone(vectors);
  wrongKey.secretLikeKeys.notSecret.push("password");
  assert.equal(validatePathSemanticsVectors(wrongKey).ok, false);
}

{
  const policy = clone(validPolicy);
  policy.fields[0].path = "product.*.title";
  assertInvalidPolicy(policy, "invalid rule path");
  const spaced = clone(validPolicy);
  spaced.fields[0].path = "product title";
  assertInvalidPolicy(spaced, "invalid rule path");
}

{
  // The fixture's own allowed example is classifiable leaf by leaf, and each wildcard rule is load-bearing.
  assert.deepEqual(blockedLeaves(validPolicy, validPolicy.providerPayloadExamples[0].payload), []);
  const withoutAttributes = clone(validPolicy);
  withoutAttributes.fields = withoutAttributes.fields.filter((field) => field.path !== "product.attributes.*");
  assertInvalidPolicy(withoutAttributes, "leaf product.attributes.material would be blocked");
}

{
  const base = { product: { title: "Kurta" } };
  const blocked = (payload) => blockedLeaves(validPolicy, payload);
  assert.deepEqual(blocked({ product: { ...base.product, attributes: { color: "navy" } } }), []);
  assert.deepEqual(blocked({ product: { attributes: { dims: { width: "10" } } } }), ["product.attributes.dims.width"]);
  assert.deepEqual(blocked({ product: { attributes: { password: "x" } } }), ["product.attributes.password"]);
  assert.deepEqual(blocked({ product: { attributes: { clientSecret: "x" } } }), ["product.attributes.clientSecret"]);
  assert.deepEqual(blocked({ "product.title": "Kurta" }), ["product.title"]);
  assert.deepEqual(blocked({ product: { categoryPath: ["Apparel", "password hunter2"] } }), ["product.categoryPath"]);
  assert.deepEqual(blocked({ product: { categoryPath: [{ token: "abc" }] } }), ["product.categoryPath"]);
  assert.deepEqual(blocked({ product: { categoryPath: ["Apparel", "Women"] } }), []);
  assert.deepEqual(blocked({ customer: { email: "" } }), ["customer.email"]);
}

// ---- AI-POL-003: explicit credential detection ----

const secretVectors = readJson(SECRET_VECTORS_PATH);

{
  const result = validateSecretDetectionVectors(secretVectors);
  assert.equal(result.ok, true, result.errors.join(String.fromCharCode(10)));
}

{
  // The vectors must be able to fail.
  const missed = clone(secretVectors);
  missed.credentials[0].detector = "bearer_token";
  assert.equal(validateSecretDetectionVectors(missed).ok, false);
  const flaggedInnocent = clone(secretVectors);
  flaggedInnocent.innocent.push(secretVectors.credentials[0].parts.join(""));
  assert.equal(validateSecretDetectionVectors(flaggedInnocent).ok, false);
  const staleResidual = clone(secretVectors);
  staleResidual.knownResidualMisses.push({ id: "now-detected", parts: secretVectors.credentials[0].parts });
  assert.equal(validateSecretDetectionVectors(staleResidual).ok, false);
}

{
  // Innocent catalog text is accepted by the static checks; a credential shape in the same field is not.
  const innocent = { product: { title: "Password Keeper Notebook A5 Maroon", description: "Secret Garden Colouring Book" } };
  assert.deepEqual(blockedLeaves(validPolicy, innocent), []);
  const credential = secretVectors.credentials.find((vector) => vector.id === "assignment-api-key").parts.join("");
  assert.deepEqual(blockedLeaves(validPolicy, { product: { title: credential } }), ["product.title"]);
  assert.equal(detectCredentialShapes(credential).includes("keyword_assignment"), true);
  assert.equal(hasCredentialShape("bearer token leaked"), false);
}

console.log("AI-POL-001 provider payload policy validator tests passed.");
