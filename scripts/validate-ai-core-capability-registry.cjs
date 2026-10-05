#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const REGISTRY = path.resolve(__dirname, "..", "apps", "api", "src", "intelligence", "intelligence-capability.registry.ts");
const SERVICE = path.resolve(__dirname, "..", "apps", "api", "src", "intelligence", "intelligence.service.ts");
const MODULE = path.resolve(__dirname, "..", "apps", "api", "src", "intelligence", "intelligence.module.ts");

const REQUIRED_IN_SCOPE = [
  "product_attribute_extraction",
  "product_specification_extraction",
  "evidence_backed_suggestions",
];

const REQUIRED_OUT_OF_SCOPE = [
  "supplier_intelligence",
  "semantic_quality_intelligence",
  "channel_intelligence",
  "copilot",
  "agents",
  "vector_search",
  "fine_tuning",
  "multi_provider_routing",
  "standalone_ai_service",
  "autonomous_publishing",
];

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function fail(errors, pathLabel, message) {
  errors.push(`${pathLabel}: ${message}`);
}

function requireIncludes(errors, source, values, pathLabel) {
  for (const value of values) {
    if (!source.includes(value)) {
      fail(errors, pathLabel, `missing ${value}`);
    }
  }
}

function validateCapabilityRegistry() {
  const errors = [];
  const registry = read(REGISTRY);
  const service = read(SERVICE);
  const module = read(MODULE);

  requireIncludes(errors, registry, REQUIRED_IN_SCOPE, "registry.inScope");
  requireIncludes(errors, registry, REQUIRED_OUT_OF_SCOPE, "registry.outOfScope");
  requireIncludes(
    errors,
    registry,
    [
      'gateStatus: "blocked_until_gate_b"',
      "providerExecution: false",
      "canonicalMutation: false",
      "humanReviewRequired: true",
      "evidenceRequired: true",
      "allowedEntityTypes: [\"product\"]",
    ],
    "registry.safety",
  );

  if (!/this\.capabilityRegistry\.listCapabilities\(\)/.test(service)) {
    fail(errors, "service.boundary", "boundary status must use the capability registry");
  }
  if (!/providers:\s*\[[\s\S]*\bIntelligenceCapabilityRegistry\b[\s\S]*\bIntelligenceService\b[\s\S]*\]/.test(module)) {
    fail(errors, "module.providers", "module must register IntelligenceCapabilityRegistry and IntelligenceService");
  }
  if (/fetch\s*\(|axios\.|OpenAI|Anthropic|GoogleGenerativeAI|product\.(create|update|upsert|delete)/.test(registry)) {
    fail(errors, "registry.forbidden", "registry must not add provider calls or Product mutation");
  }

  return { ok: errors.length === 0, errors };
}

function runCli() {
  const result = validateCapabilityRegistry();
  if (!result.ok) {
    console.error("AI-CORE-004 capability registry validation failed:");
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(
    `AI-CORE-004 capability registry validation passed: ${REQUIRED_IN_SCOPE.length} in-scope capabilities, ${REQUIRED_OUT_OF_SCOPE.length} out-of-scope capabilities.`,
  );
}

if (require.main === module) {
  runCli();
}

module.exports = {
  REQUIRED_IN_SCOPE,
  REQUIRED_OUT_OF_SCOPE,
  validateCapabilityRegistry,
};
