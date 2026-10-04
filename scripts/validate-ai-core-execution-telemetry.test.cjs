#!/usr/bin/env node

const assert = require("node:assert/strict");
const { readJson, validateExecutionTelemetry } = require("./validate-ai-core-execution-telemetry.cjs");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function expectInvalid(name, mutate, expectedSnippet) {
  const contract = clone(baseContract);
  mutate(contract);
  const result = validateExecutionTelemetry(contract);
  assert.equal(result.ok, false, `${name} unexpectedly passed validation`);
  assert(
    result.errors.some((error) => error.includes(expectedSnippet)),
    `${name} did not include expected error snippet "${expectedSnippet}". Errors: ${result.errors.join("; ")}`,
  );
}

const baseContract = readJson();
const validResult = validateExecutionTelemetry(baseContract);
assert.equal(validResult.ok, true, `valid fixture failed: ${validResult.errors.join("; ")}`);

expectInvalid(
  "missing tenant identity",
  (contract) => {
    contract.identityFields = contract.identityFields.filter((field) => field !== "tenantKey");
  },
  "missing tenantKey",
);

expectInvalid(
  "missing schema version from fingerprint",
  (contract) => {
    contract.idempotencyFingerprintFields = contract.idempotencyFingerprintFields.filter((field) => field !== "schemaVersion");
  },
  "missing schemaVersion",
);

expectInvalid(
  "successful provider call has negative cost",
  (contract) => {
    contract.examples.find((example) => example.exampleId === "AI-CORE-002-SUCCESS").estimatedCostMicros = -1;
  },
  "non-negative integer",
);

expectInvalid(
  "successful provider call missing usage",
  (contract) => {
    const example = contract.examples.find((entry) => entry.exampleId === "AI-CORE-002-SUCCESS");
    example.inputTokens = 0;
    example.outputTokens = 0;
    example.totalTokens = 0;
  },
  "must capture usage",
);

expectInvalid(
  "blocked execution has cost",
  (contract) => {
    contract.examples.find((example) => example.exampleId === "AI-CORE-002-KILL-SWITCH-BLOCKED").estimatedCostMicros = 100;
  },
  "zero cost and zero tokens",
);

expectInvalid(
  "blocked execution does not explain no-call",
  (contract) => {
    contract.examples.find((example) => example.exampleId === "AI-CORE-002-POLICY-BLOCKED").failureClass = null;
  },
  "failureClass",
);

expectInvalid(
  "secret-like provider field",
  (contract) => {
    contract.examples.find((example) => example.exampleId === "AI-CORE-002-SUCCESS").apiKey = "removed";
  },
  "forbidden credential/raw payload field",
);

expectInvalid(
  "token total mismatch",
  (contract) => {
    contract.examples.find((example) => example.exampleId === "AI-CORE-002-SUCCESS").totalTokens = 999;
  },
  "known token components",
);

expectInvalid(
  "provider timeout non-retryable",
  (contract) => {
    contract.examples.find((example) => example.exampleId === "AI-CORE-002-PROVIDER-TIMEOUT").retryable = false;
  },
  "provider_timeout must be retryable",
);

expectInvalid(
  "actual cost without provider reported source",
  (contract) => {
    const example = contract.examples.find((entry) => entry.exampleId === "AI-CORE-002-SUCCESS");
    example.actualCostMicros = 12000;
    example.costSource = "estimated";
  },
  "actualCostMicros requires",
);

expectInvalid(
  "credentials persisted",
  (contract) => {
    contract.examples.find((example) => example.exampleId === "AI-CORE-002-SUCCESS").containsCredentials = true;
  },
  "must always be false",
);

console.log("AI-CORE-002 execution telemetry validator tests passed.");
