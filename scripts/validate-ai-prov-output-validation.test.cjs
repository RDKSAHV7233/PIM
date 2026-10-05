const assert = require("node:assert/strict");
const { validateProviderOutputValidation } = require("./validate-ai-prov-output-validation.cjs");

const result = validateProviderOutputValidation();

assert.equal(result.ok, true, result.errors.join("\n"));

console.log("AI-PROV-002 provider output validation tests passed.");
