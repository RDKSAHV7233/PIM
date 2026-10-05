#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const SERVICE = path.resolve(__dirname, "..", "apps", "api", "src", "intelligence", "intelligence.service.ts");
const TYPES = path.resolve(__dirname, "..", "apps", "api", "src", "intelligence", "intelligence.types.ts");
const MODULE = path.resolve(__dirname, "..", "apps", "api", "src", "intelligence", "intelligence.module.ts");
const FIXTURE = path.resolve(__dirname, "..", "apps", "api", "src", "intelligence", "intelligence-fixture.adapter.ts");
const CONTROLLER = path.resolve(__dirname, "..", "apps", "api", "src", "intelligence", "intelligence.controller.ts");

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function fail(errors, pathLabel, message) {
  errors.push(`${pathLabel}: ${message}`);
}

function extractMethod(source, methodName) {
  const start = source.indexOf(`async ${methodName}(`);
  if (start < 0) {
    return "";
  }
  const nextMethod = source.slice(start + 1).search(/\n\s+(async\s+|private\s+)/);
  return nextMethod < 0 ? source.slice(start) : source.slice(start, start + 1 + nextMethod);
}

function validateAdapterContract() {
  const errors = [];
  const service = read(SERVICE);
  const types = read(TYPES);
  const moduleSource = read(MODULE);
  const fixture = read(FIXTURE);
  const controller = read(CONTROLLER);
  const allSource = [service, types, moduleSource, fixture, controller].join("\n");
  const runnerMethod = extractMethod(service, "runFixtureAdapterContract");

  if (!/class\s+FixtureIntelligenceAdapter/.test(fixture)) {
    fail(errors, "fixture", "must provide a fixture intelligence adapter");
  }
  if (!/async\s+generateStructuredOutput\(/.test(fixture)) {
    fail(errors, "fixture.generateStructuredOutput", "must expose structured fixture output generation");
  }
  if (!/async\s+runFixtureAdapterContract\(/.test(service)) {
    fail(errors, "service.runFixtureAdapterContract", "must expose an internal fixture adapter contract runner");
  }
  if (!/this\.prepareIntelligencePayloadDryRun\(input\)/.test(service)) {
    fail(errors, "service.preflight", "must run payload dry-run before adapter invocation");
  }
  if (!/this\.fixtureAdapter\.generateStructuredOutput/.test(service)) {
    fail(errors, "service.fixtureAdapter", "must invoke only the fixture adapter");
  }
  if (!/this\.validateStructuredOutputForSuggestions\(\{/.test(service)) {
    fail(errors, "service.outputValidation", "must route adapter output through structured output validation");
  }
  for (const contract of [
    "IntelligenceAdapterRequest",
    "IntelligenceAdapterResponse",
    "IntelligenceAdapterUsage",
    "RunFixtureIntelligenceAdapterInput",
    "FixtureIntelligenceAdapterRunResult",
  ]) {
    if (!types.includes(contract)) {
      fail(errors, "types", `must declare ${contract}`);
    }
  }
  if (!/estimatedCostMicros:\s*0/.test(fixture) || !/providerCallAttempted:\s*false/.test(fixture)) {
    fail(errors, "fixture.noLiveCost", "fixture adapter must record zero cost and no provider call");
  }
  if (!/payloadAllowed:\s*false/.test(service) || !/!dryRun\.allowed/.test(service)) {
    fail(errors, "service.blockedBoundary", "blocked payloads must stop before the adapter boundary");
  }
  if (/@(Post|Patch|Put|Delete)\s*\(/.test(controller)) {
    fail(errors, "controller", "adapter contract must not add public write routes");
  }
  if (
    /from\s+["'](openai|@openai\/openai|@anthropic-ai\/sdk|@google\/generative-ai|google-genai|langchain|@langchain\/[^"']+|cohere-ai|mistralai|groq-sdk|replicate|ollama|ai)["']/.test(
      allSource,
    )
  ) {
    fail(errors, "source.sdk", "must not import provider or model SDKs");
  }
  if (/\b(fetch\s*\(|axios\.|httpClient\.|new\s+OpenAI|new\s+Anthropic|GoogleGenerativeAI)\b/.test(allSource)) {
    fail(errors, "source.network", "must not add network calls or provider clients");
  }
  if (/process\.env|API_KEY|SECRET|TOKEN/.test(allSource)) {
    fail(errors, "source.config", "must not add provider env/config/secrets");
  }
  if (/product\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/.test(allSource)) {
    fail(errors, "source.productMutation", "must not mutate Product records");
  }
  if (/aiSuggestion\.(create|createMany|upsert|update|updateMany)\s*\(|createSuggestion\s*\(/.test(runnerMethod)) {
    fail(errors, "service.persistence", "adapter contract runner must not persist suggestions");
  }

  return { ok: errors.length === 0, errors };
}

function runCli() {
  const result = validateAdapterContract();
  if (!result.ok) {
    console.error("AI-PROV-003 adapter contract validation failed:");
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log("AI-PROV-003 adapter contract validation passed: fixture only, no live provider access, no mutation.");
}

if (require.main === module) {
  runCli();
}

module.exports = {
  validateAdapterContract,
};
