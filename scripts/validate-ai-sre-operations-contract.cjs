#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_CONTRACT = path.resolve(
  __dirname,
  "..",
  "test-fixtures",
  "ai-sre",
  "operations-contract.v1.json",
);

const REQUIRED_FINGERPRINT = [
  "tenant",
  "product",
  "sourceVersion",
  "capability",
  "promptVersion",
  "schemaVersion",
];

const REQUIRED_JOB_SECTIONS = ["retry", "timeout", "cancellation", "deadLetter", "tenantIsolation"];
const REQUIRED_OUTAGE_EVIDENCE = [
  "provider_outage_signal",
  "intelligence_degraded_status",
  "core_pim_health_check",
  "no_canonical_ai_write",
  "no_provider_cost_for_blocked_call",
];

function readJson(filePath = DEFAULT_CONTRACT) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function fail(errors, pathLabel, message) {
  errors.push(`${pathLabel}: ${message}`);
}

function assertIncludesAll(errors, actual, required, pathLabel) {
  if (!Array.isArray(actual)) {
    fail(errors, pathLabel, "must be an array");
    return;
  }
  for (const item of required) {
    if (!actual.includes(item)) {
      fail(errors, pathLabel, `missing ${item}`);
    }
  }
}

function validateContract(contract) {
  const errors = [];

  if (!contract || typeof contract !== "object" || Array.isArray(contract)) {
    return { ok: false, errors: ["$: contract must be an object"] };
  }

  if (contract.contractId !== "AI-SRE-001-OPERATIONS-CONTRACT-V1") {
    fail(errors, "$.contractId", "must be AI-SRE-001-OPERATIONS-CONTRACT-V1");
  }
  if (contract.version !== 1) {
    fail(errors, "$.version", "must be 1");
  }
  if (contract.nonRuntime !== true) {
    fail(errors, "$.nonRuntime", "must be true");
  }
  if (contract.owner !== "sre-backend-data-finops") {
    fail(errors, "$.owner", "must be sre-backend-data-finops");
  }

  if (!contract.killSwitch || typeof contract.killSwitch !== "object") {
    fail(errors, "$.killSwitch", "must be present");
  } else {
    if (contract.killSwitch.defaultState !== "disabled_until_gate_b") {
      fail(errors, "$.killSwitch.defaultState", "must be disabled_until_gate_b");
    }
    const disabled = contract.killSwitch.disabledBehavior ?? {};
    if (disabled.providerExecution !== "blocked_before_provider_call") {
      fail(errors, "$.killSwitch.disabledBehavior.providerExecution", "must block before provider call");
    }
    if (disabled.corePimAvailability !== "must_remain_available") {
      fail(errors, "$.killSwitch.disabledBehavior.corePimAvailability", "must preserve core PIM availability");
    }
    assertIncludesAll(
      errors,
      contract.killSwitch.requiredEvidence,
      ["operator_visible_status", "provider_call_prevention", "core_pim_health_unaffected"],
      "$.killSwitch.requiredEvidence",
    );
  }

  if (!contract.jobPolicy || typeof contract.jobPolicy !== "object") {
    fail(errors, "$.jobPolicy", "must be present");
  } else {
    assertIncludesAll(errors, contract.jobPolicy.idempotencyFingerprint, REQUIRED_FINGERPRINT, "$.jobPolicy.idempotencyFingerprint");
    for (const section of REQUIRED_JOB_SECTIONS) {
      if (!contract.jobPolicy[section] || typeof contract.jobPolicy[section] !== "object") {
        fail(errors, `$.jobPolicy.${section}`, "must be present");
      }
    }
    if ((contract.jobPolicy.retry?.maxAttempts ?? 0) < 1) {
      fail(errors, "$.jobPolicy.retry.maxAttempts", "must be at least 1");
    }
    if ((contract.jobPolicy.timeout?.providerCallTimeoutMs ?? 0) <= 0) {
      fail(errors, "$.jobPolicy.timeout.providerCallTimeoutMs", "must be positive");
    }
    if (contract.jobPolicy.timeout?.timeoutBehavior !== "fail_intelligence_job_only") {
      fail(errors, "$.jobPolicy.timeout.timeoutBehavior", "must fail Intelligence job only");
    }
    if (contract.jobPolicy.deadLetter?.enabled !== true || contract.jobPolicy.deadLetter?.reasonRequired !== true) {
      fail(errors, "$.jobPolicy.deadLetter", "must be enabled and require reason");
    }
    assertIncludesAll(
      errors,
      contract.jobPolicy.deadLetter?.mustInclude,
      ["tenant", "capability", "fingerprint", "failureClass", "lastErrorCode"],
      "$.jobPolicy.deadLetter.mustInclude",
    );
    if (contract.jobPolicy.tenantIsolation?.crossTenantLeakageAllowed !== false) {
      fail(errors, "$.jobPolicy.tenantIsolation.crossTenantLeakageAllowed", "must be false");
    }
  }

  if (!contract.providerOutage || typeof contract.providerOutage !== "object") {
    fail(errors, "$.providerOutage", "must be present");
  } else {
    if (contract.providerOutage.degradationMode !== "intelligence_unavailable_core_pim_available") {
      fail(errors, "$.providerOutage.degradationMode", "must preserve core PIM while degrading Intelligence");
    }
    assertIncludesAll(
      errors,
      contract.providerOutage.mustRemainAvailable,
      ["catalog_read", "catalog_validation", "quality_approval_review", "audit_read", "auth"],
      "$.providerOutage.mustRemainAvailable",
    );
    assertIncludesAll(
      errors,
      contract.providerOutage.mustFailClosed,
      ["provider_execution", "new_ai_generation"],
      "$.providerOutage.mustFailClosed",
    );
    assertIncludesAll(errors, contract.providerOutage.requiredEvidence, REQUIRED_OUTAGE_EVIDENCE, "$.providerOutage.requiredEvidence");
  }

  const thresholds = contract.pilotSafetyThresholds ?? {};
  for (const [key, expected] of Object.entries({
    crossTenantLeakage: 0,
    secretLeakage: 0,
    unauthorizedCanonicalWrites: 0,
    directModelMutationPaths: 0,
    staleTamperedSuggestionAcceptance: 0,
    requiredEvidenceCoveragePercent: 100,
    providerExecutionCostVisibilityPercent: 100,
  })) {
    if (thresholds[key] !== expected) {
      fail(errors, `$.pilotSafetyThresholds.${key}`, `must be ${expected}`);
    }
  }

  return { ok: errors.length === 0, errors };
}

function runCli() {
  const contract = readJson();
  const result = validateContract(contract);
  if (!result.ok) {
    console.error("AI-SRE-001 operations contract validation failed:");
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(
    `AI-SRE-001 operations contract validation passed: ${contract.jobPolicy.idempotencyFingerprint.length} fingerprint fields, ${contract.providerOutage.requiredEvidence.length} outage evidence checks.`,
  );
}

if (require.main === module) {
  runCli();
}

module.exports = {
  DEFAULT_CONTRACT,
  REQUIRED_FINGERPRINT,
  REQUIRED_OUTAGE_EVIDENCE,
  readJson,
  validateContract,
};
