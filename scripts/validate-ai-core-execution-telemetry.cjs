#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_CONTRACT = path.resolve(
  __dirname,
  "..",
  "test-fixtures",
  "ai-core",
  "execution-telemetry.v1.json",
);

const REQUIRED_IDENTITY_FIELDS = new Set([
  "id",
  "tenantKey",
  "capability",
  "entityType",
  "entityId",
  "sourceRecordId",
  "sourceVersion",
  "sourceHash",
  "requestFingerprint",
  "promptVersion",
  "schemaVersion",
  "createdByActorId",
  "createdByActorRole",
  "correlationId",
  "idempotencyFingerprint",
]);
const REQUIRED_FINGERPRINT_FIELDS = new Set([
  "tenantKey",
  "capability",
  "entityType",
  "entityId",
  "sourceVersion",
  "sourceHash",
  "requestFingerprint",
  "promptVersion",
  "schemaVersion",
]);
const REQUIRED_LIFECYCLE_STATES = new Set([
  "queued",
  "validating",
  "blocked",
  "running",
  "succeeded",
  "failed",
  "timed_out",
  "budget_blocked",
  "provider_disabled",
  "cancelled",
]);
const REQUIRED_TELEMETRY_FIELDS = new Set([
  "providerKey",
  "providerDisplayName",
  "modelKey",
  "modelVersion",
  "providerRegion",
  "providerPolicyVersion",
  "classificationPolicyVersion",
  "redactionPolicyVersion",
  "promptTemplateHash",
  "schemaHash",
  "outputContractVersion",
  "capabilityContractVersion",
  "startedAt",
  "finishedAt",
  "durationMs",
  "attemptNumber",
  "maxAttempts",
  "retryable",
  "inputTokens",
  "outputTokens",
  "cachedInputTokens",
  "reasoningTokens",
  "totalTokens",
  "billableUnits",
  "estimatedCostMicros",
  "actualCostMicros",
  "currency",
  "costSource",
  "pricingVersion",
  "budgetPeriodKey",
]);
const REQUIRED_REPORTING_DIMENSIONS = new Set(["tenantKey", "capability", "providerKey", "modelKey", "status", "dateBucket"]);
const REQUIRED_FAILURE_CLASSES = new Set([
  "validation_error",
  "classification_blocked",
  "redaction_failed",
  "tenant_policy_blocked",
  "budget_exhausted",
  "provider_disabled",
  "provider_timeout",
  "provider_rate_limited",
  "provider_auth_error",
  "provider_5xx",
  "provider_schema_invalid",
  "unsafe_output",
  "internal_error",
]);
const SECRET_VALUE_PATTERN = /(sk-[a-z0-9]|bearer\s+[a-z0-9]|oauth|private[\s_-]?key|webhook[\s_-]?secret|api[\s_-]?key|password|credential|secret)/i;

function readJson(filePath = DEFAULT_CONTRACT) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function fail(errors, pathLabel, message) {
  errors.push(`${pathLabel}: ${message}`);
}

function assertIncludes(errors, values, required, pathLabel) {
  if (!Array.isArray(values)) {
    fail(errors, pathLabel, "must be an array");
    return;
  }
  for (const value of required) {
    if (!values.includes(value)) {
      fail(errors, pathLabel, `missing ${value}`);
    }
  }
}

function flattenStrings(value, prefix = "$", out = []) {
  if (typeof value === "string") {
    out.push({ path: prefix, value });
    return out;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => flattenStrings(entry, `${prefix}[${index}]`, out));
    return out;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      flattenStrings(child, `${prefix}.${key}`, out);
    }
  }
  return out;
}

function walkKeys(value, prefix = "$", out = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkKeys(entry, `${prefix}[${index}]`, out));
    return out;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      out.push({ path: `${prefix}.${key}`, key });
      walkKeys(child, `${prefix}.${key}`, out);
    }
  }
  return out;
}

function assertNonNegativeInteger(errors, value, pathLabel) {
  if (!Number.isInteger(value) || value < 0) {
    fail(errors, pathLabel, "must be a non-negative integer");
  }
}

function validateExample(example, index, errors, lifecycleStates) {
  const base = `$.examples[${index}]`;
  for (const field of [...REQUIRED_IDENTITY_FIELDS, ...REQUIRED_TELEMETRY_FIELDS, "status", "providerCallAttempted", "auditEventIds"]) {
    if (example[field] === undefined || example[field] === "") {
      fail(errors, `${base}.${field}`, "is required");
    }
  }

  if (!lifecycleStates.has(example.status)) {
    fail(errors, `${base}.status`, "must be a declared lifecycle state");
  }
  if (typeof example.providerCallAttempted !== "boolean") {
    fail(errors, `${base}.providerCallAttempted`, "must be boolean");
  }

  for (const field of ["durationMs", "attemptNumber", "maxAttempts", "inputTokens", "outputTokens", "cachedInputTokens", "reasoningTokens", "totalTokens", "billableUnits", "estimatedCostMicros"]) {
    assertNonNegativeInteger(errors, example[field], `${base}.${field}`);
  }
  if (example.actualCostMicros !== null && example.actualCostMicros !== undefined) {
    assertNonNegativeInteger(errors, example.actualCostMicros, `${base}.actualCostMicros`);
    if (!["provider_reported", "reconciled"].includes(example.costSource)) {
      fail(errors, `${base}.costSource`, "actualCostMicros requires provider_reported or reconciled costSource");
    }
  }
  if (
    Number.isInteger(example.inputTokens) &&
    Number.isInteger(example.outputTokens) &&
    Number.isInteger(example.cachedInputTokens) &&
    Number.isInteger(example.reasoningTokens) &&
    example.totalTokens !== example.inputTokens + example.outputTokens + example.cachedInputTokens + example.reasoningTokens
  ) {
    fail(errors, `${base}.totalTokens`, "must equal known token components");
  }

  if (example.providerCallAttempted === true && ["blocked", "budget_blocked", "provider_disabled"].includes(example.status)) {
    fail(errors, `${base}.status`, "blocked statuses cannot have providerCallAttempted=true");
  }
  if (example.providerCallAttempted === false) {
    if (example.estimatedCostMicros !== 0 || example.totalTokens !== 0) {
      fail(errors, base, "blocked/no-call executions must record zero cost and zero tokens");
    }
    if (!example.failureClass) {
      fail(errors, `${base}.failureClass`, "is required when provider call is blocked");
    }
    if (example.requestPayloadHash !== null && ["classification_blocked", "tenant_policy_blocked", "budget_exhausted", "kill_switch_disabled"].includes(example.failureClass)) {
      fail(errors, `${base}.requestPayloadHash`, "must not persist a raw blocked provider payload hash before provider execution");
    }
  }

  if (example.status === "succeeded") {
    if (example.providerCallAttempted !== true) {
      fail(errors, `${base}.providerCallAttempted`, "successful provider calls must be attempted");
    }
    if (example.estimatedCostMicros < 0) {
      fail(errors, `${base}.estimatedCostMicros`, "successful provider calls must capture non-negative cost");
    }
    if (example.totalTokens <= 0) {
      fail(errors, `${base}.totalTokens`, "successful provider calls must capture usage");
    }
    for (const field of ["responsePayloadHash", "generatedPayloadHash", "validationEvidenceId"]) {
      if (!example[field]) {
        fail(errors, `${base}.${field}`, "is required for succeeded executions");
      }
    }
  }

  if (["succeeded", "failed", "timed_out", "budget_blocked", "provider_disabled", "blocked"].includes(example.status)) {
    if (!Array.isArray(example.auditEventIds) || example.auditEventIds.length === 0) {
      fail(errors, `${base}.auditEventIds`, "terminal statuses require audit linkage");
    }
  }

  if (["failed", "timed_out", "budget_blocked", "provider_disabled", "blocked"].includes(example.status) && !example.failureClass) {
    fail(errors, `${base}.failureClass`, "is required for failure or blocked statuses");
  }
  if (example.failureClass && !REQUIRED_FAILURE_CLASSES.has(example.failureClass) && example.failureClass !== "kill_switch_disabled") {
    fail(errors, `${base}.failureClass`, "must be a declared failure class");
  }
  if (example.failureClass === "provider_timeout" && example.retryable !== true) {
    fail(errors, `${base}.retryable`, "provider_timeout must be retryable unless a later policy exception is added");
  }
  if (example.currency !== "USD") {
    fail(errors, `${base}.currency`, "must be USD in v1 contract examples");
  }
  if (example.containsCredentials !== false) {
    fail(errors, `${base}.containsCredentials`, "must always be false");
  }
  if (example.containsBlockedData !== false) {
    fail(errors, `${base}.containsBlockedData`, "must always be false");
  }

  for (const entry of flattenStrings(example, base)) {
    if (entry.path.includes(".blockedFields")) {
      continue;
    }
    if (SECRET_VALUE_PATTERN.test(entry.value)) {
      fail(errors, entry.path, "must not contain secret-like field names or values");
    }
  }
}

function validateExecutionTelemetry(contract) {
  const errors = [];
  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    return { ok: false, errors: ["$: contract must be an object"] };
  }

  if (contract.contractId !== "AI-CORE-002-EXECUTION-TELEMETRY-V1") {
    fail(errors, "$.contractId", "must be AI-CORE-002-EXECUTION-TELEMETRY-V1");
  }
  if (contract.version !== 1) {
    fail(errors, "$.version", "must be 1");
  }
  if (contract.nonRuntime !== true) {
    fail(errors, "$.nonRuntime", "must be true");
  }
  if (contract.owner !== "backend-data-finops") {
    fail(errors, "$.owner", "must be backend-data-finops");
  }
  if (contract.gateStatus !== "blocked_until_gate_a_passes") {
    fail(errors, "$.gateStatus", "must remain blocked_until_gate_a_passes");
  }
  if (contract.invariant !== "no_provider_call_without_ai_execution_record") {
    fail(errors, "$.invariant", "must require an AiExecution record before provider calls");
  }

  assertIncludes(errors, contract.identityFields, REQUIRED_IDENTITY_FIELDS, "$.identityFields");
  assertIncludes(errors, contract.idempotencyFingerprintFields, REQUIRED_FINGERPRINT_FIELDS, "$.idempotencyFingerprintFields");
  assertIncludes(errors, contract.lifecycleStates, REQUIRED_LIFECYCLE_STATES, "$.lifecycleStates");
  assertIncludes(errors, contract.requiredTelemetryFields, REQUIRED_TELEMETRY_FIELDS, "$.requiredTelemetryFields");
  assertIncludes(errors, contract.reportingDimensions, REQUIRED_REPORTING_DIMENSIONS, "$.reportingDimensions");
  assertIncludes(errors, contract.failureClasses, REQUIRED_FAILURE_CLASSES, "$.failureClasses");

  const forbiddenFields = new Set(contract.forbiddenFieldNames ?? []);
  for (const entry of walkKeys(contract)) {
    if (entry.path.includes("$.forbiddenFieldNames")) {
      continue;
    }
    if (forbiddenFields.has(entry.key)) {
      fail(errors, entry.path, "forbidden credential/raw payload field is present");
    }
  }

  const lifecycleStates = new Set(contract.lifecycleStates ?? []);
  if (!Array.isArray(contract.examples) || contract.examples.length < 4) {
    fail(errors, "$.examples", "must include success, failure, and blocked examples");
  } else {
    contract.examples.forEach((example, index) => validateExample(example, index, errors, lifecycleStates));
    const statuses = new Set(contract.examples.map((example) => example.status));
    for (const status of ["succeeded", "timed_out", "blocked", "provider_disabled"]) {
      if (!statuses.has(status)) {
        fail(errors, "$.examples", `missing ${status} example`);
      }
    }
  }

  for (const entry of flattenStrings(contract)) {
    if (
      SECRET_VALUE_PATTERN.test(entry.value) &&
      !String(entry.path).includes("forbiddenFieldNames") &&
      !String(entry.path).includes("blockedFields")
    ) {
      fail(errors, entry.path, "must not contain secret-like text outside forbiddenFieldNames");
    }
  }

  return { ok: errors.length === 0, errors };
}

function runCli() {
  const contract = readJson();
  const result = validateExecutionTelemetry(contract);
  if (!result.ok) {
    console.error("AI-CORE-002 execution telemetry validation failed:");
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(
    `AI-CORE-002 execution telemetry validation passed: ${contract.examples.length} examples, ${contract.requiredTelemetryFields.length} telemetry fields.`,
  );
}

if (require.main === module) {
  runCli();
}

module.exports = {
  DEFAULT_CONTRACT,
  REQUIRED_FAILURE_CLASSES,
  readJson,
  validateExecutionTelemetry,
};
