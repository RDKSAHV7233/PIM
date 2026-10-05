const assert = require("node:assert/strict");
const { validateCapabilityRegistry } = require("./validate-ai-core-capability-registry.cjs");

const result = validateCapabilityRegistry();

assert.equal(result.ok, true, result.errors.join("\n"));

console.log("AI-CORE-004 capability registry validator tests passed.");
