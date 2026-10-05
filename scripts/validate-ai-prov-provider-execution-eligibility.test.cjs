#!/usr/bin/env node

const assert = require("node:assert/strict");
const { validateProviderExecutionEligibility } = require("./validate-ai-prov-provider-execution-eligibility.cjs");

const result = validateProviderExecutionEligibility();

assert.equal(result.ok, true, result.errors.join("\n"));
assert.deepEqual(result.errors, []);

console.log("validate-ai-prov-provider-execution-eligibility tests passed.");
