#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const SERVICE = path.resolve(__dirname, "..", "apps", "api", "src", "intelligence", "intelligence.service.ts");
const TYPES = path.resolve(__dirname, "..", "apps", "api", "src", "intelligence", "intelligence.types.ts");
const CONTROLLER = path.resolve(__dirname, "..", "apps", "api", "src", "intelligence", "intelligence.controller.ts");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function fail(errors, pathLabel, message) {
  errors.push(`${pathLabel}: ${message}`);
}

function validateDryRun() {
  const errors = [];
  const service = read(SERVICE);
  const types = read(TYPES);
  const controller = read(CONTROLLER);

  if (!/async\s+prepareIntelligencePayloadDryRun\(/.test(service)) {
    fail(errors, "service.prepareIntelligencePayloadDryRun", "must expose an internal dry-run method");
  }
  if (!/this\.classifyPayloadForIntelligence\(input\)/.test(service)) {
    fail(errors, "service.classification", "dry-run must use tenant policy classification");
  }
  if (!/this\.recordPolicyBlockedExecution\(\{[\s\S]*executionId:\s*input\.executionId/.test(service)) {
    fail(errors, "service.blockedTelemetry", "blocked dry-runs with executionId must record blocked telemetry");
  }
  if (!/providerCallAttempted:\s*false[\s\S]*estimatedCostMicros:\s*0/.test(service)) {
    fail(errors, "service.noCall", "dry-run result must prove no provider call and zero cost");
  }
  if (!/PrepareIntelligencePayloadDryRunInput/.test(types) || !/IntelligencePayloadDryRunResult/.test(types)) {
    fail(errors, "types", "must declare dry-run input and result contracts");
  }
  if (/@(Post|Patch|Put|Delete)\s*\(/.test(controller)) {
    fail(errors, "controller", "dry-run must not add public write routes");
  }
  if (/fetch\s*\(|axios\.|OpenAI|Anthropic|GoogleGenerativeAI|ProviderAdapter|product\.(create|update|upsert|delete)/.test(service)) {
    fail(errors, "service.forbidden", "dry-run must not add provider execution or Product mutation");
  }

  return { ok: errors.length === 0, errors };
}

function runCli() {
  const result = validateDryRun();
  if (!result.ok) {
    console.error("AI-PROV-001 payload dry-run validation failed:");
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log("AI-PROV-001 payload dry-run validation passed: classification-only, no provider call, no write route.");
}

if (require.main === module) {
  runCli();
}

module.exports = {
  validateDryRun,
};
