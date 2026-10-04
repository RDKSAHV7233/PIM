#!/usr/bin/env node

const assert = require("node:assert/strict");

const { readJson, validateContract } = require("./validate-ai-sre-operations-contract.cjs");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertInvalid(contract, expectedMessage) {
  const result = validateContract(contract);
  assert.equal(result.ok, false, "contract should be invalid");
  assert(
    result.errors.some((error) => error.includes(expectedMessage)),
    `expected error including "${expectedMessage}", got:\n${result.errors.join("\n")}`,
  );
}

const validContract = readJson();

{
  const result = validateContract(validContract);
  assert.equal(result.ok, true, result.errors.join("\n"));
}

{
  const contract = clone(validContract);
  contract.killSwitch.defaultState = "enabled";
  assertInvalid(contract, "disabled_until_gate_b");
}

{
  const contract = clone(validContract);
  contract.killSwitch.disabledBehavior.providerExecution = "best_effort";
  assertInvalid(contract, "provider call");
}

{
  const contract = clone(validContract);
  contract.jobPolicy.idempotencyFingerprint = contract.jobPolicy.idempotencyFingerprint.filter((field) => field !== "schemaVersion");
  assertInvalid(contract, "schemaVersion");
}

{
  const contract = clone(validContract);
  contract.jobPolicy.deadLetter.reasonRequired = false;
  assertInvalid(contract, "require reason");
}

{
  const contract = clone(validContract);
  contract.jobPolicy.tenantIsolation.crossTenantLeakageAllowed = true;
  assertInvalid(contract, "must be false");
}

{
  const contract = clone(validContract);
  contract.providerOutage.degradationMode = "platform_unavailable";
  assertInvalid(contract, "core PIM");
}

{
  const contract = clone(validContract);
  contract.pilotSafetyThresholds.secretLeakage = 1;
  assertInvalid(contract, "must be 0");
}

console.log("AI-SRE-001 operations contract validator tests passed.");
