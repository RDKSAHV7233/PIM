#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");

const DEFAULT_POLICY = path.resolve(
  __dirname,
  "..",
  "test-fixtures",
  "ai-policy",
  "provider-payload-policy.v1.json",
);

const CLASSIFICATIONS = new Set(["AI_ALLOWED", "AI_ALLOWED_WITH_REDACTION", "AI_BLOCKED"]);
const SECRET_VALUE_PATTERN = /\b(token|secret|credential|api[\s_-]?key|access[\s_-]?key|refresh[\s_-]?token|private[\s_-]?key|password)\b/i;

function readJson(filePath = DEFAULT_POLICY) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function fail(errors, pathLabel, message) {
  errors.push(`${pathLabel}: ${message}`);
}

function getByPath(value, dotPath) {
  return dotPath.split(".").reduce((current, segment) => {
    if (current === undefined || current === null) {
      return undefined;
    }
    return current[segment];
  }, value);
}

function hasByPath(value, dotPath) {
  return getByPath(value, dotPath) !== undefined;
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

function buildFieldMap(policy) {
  return new Map(policy.fields.map((field) => [field.path, field]));
}

function validatePayloadAgainstPolicy(policy, payload, options = {}) {
  const errors = [];
  const fieldMap = buildFieldMap(policy);
  const redactedFields = Array.isArray(payload.redactedFields) ? payload.redactedFields.map(String) : [];

  for (const field of fieldMap.values()) {
    if (!hasByPath(payload, field.path)) {
      continue;
    }

    const value = getByPath(payload, field.path);
    if (field.classification === "AI_BLOCKED") {
      fail(errors, field.path, "AI_BLOCKED field is present in provider payload");
      continue;
    }

    if (field.classification === "AI_ALLOWED_WITH_REDACTION") {
      if (!redactedFields.includes(field.path)) {
        fail(errors, field.path, "redactable field is present without redactedFields evidence");
      }
      if (typeof value === "string" && value.includes("@") && !value.startsWith("[REDACTED")) {
        fail(errors, field.path, "redactable email-like value is not redacted");
      }
      if (typeof value === "string" && SECRET_VALUE_PATTERN.test(value) && !value.includes("removed")) {
        fail(errors, field.path, "redactable sensitive value is not safely transformed");
      }
    }
  }

  for (const entry of flattenStrings(payload)) {
    if (SECRET_VALUE_PATTERN.test(entry.value)) {
      fail(errors, entry.path, "payload contains sensitive secret-like text");
    }
  }

  if (options.expectValid === false && errors.length === 0) {
    fail(errors, "$", "blocked payload example unexpectedly passed validation");
  }

  return { ok: errors.length === 0, errors };
}

function validatePolicy(policy) {
  const errors = [];

  if (!policy || typeof policy !== "object" || Array.isArray(policy)) {
    return { ok: false, errors: ["$: policy must be an object"] };
  }

  if (policy.policyId !== "AI-POL-001-PROVIDER-PAYLOAD-POLICY-V1") {
    fail(errors, "$.policyId", "must be AI-POL-001-PROVIDER-PAYLOAD-POLICY-V1");
  }
  if (policy.version !== 1) {
    fail(errors, "$.version", "must be 1");
  }
  if (policy.nonRuntime !== true) {
    fail(errors, "$.nonRuntime", "must be true");
  }
  if (policy.owner !== "privacy-security-backend") {
    fail(errors, "$.owner", "must be privacy-security-backend");
  }

  if (!Array.isArray(policy.classificationValues)) {
    fail(errors, "$.classificationValues", "must be an array");
  } else {
    for (const classification of CLASSIFICATIONS) {
      if (!policy.classificationValues.includes(classification)) {
        fail(errors, "$.classificationValues", `missing ${classification}`);
      }
    }
  }

  if (!Array.isArray(policy.fields) || policy.fields.length === 0) {
    fail(errors, "$.fields", "must be a non-empty array");
  } else {
    const paths = new Set();
    let blockedCount = 0;
    let redactCount = 0;
    for (const [index, field] of policy.fields.entries()) {
      const base = `$.fields[${index}]`;
      if (!field.path || typeof field.path !== "string") {
        fail(errors, `${base}.path`, "must be a non-empty string");
      } else if (paths.has(field.path)) {
        fail(errors, `${base}.path`, `duplicate path ${field.path}`);
      } else {
        paths.add(field.path);
      }
      if (!CLASSIFICATIONS.has(field.classification)) {
        fail(errors, `${base}.classification`, "must be a supported AI classification");
      }
      if (!field.reason || typeof field.reason !== "string") {
        fail(errors, `${base}.reason`, "must be a non-empty string");
      }
      if (field.classification === "AI_BLOCKED") {
        blockedCount += 1;
      }
      if (field.classification === "AI_ALLOWED_WITH_REDACTION") {
        redactCount += 1;
        if (!field.redaction || field.redaction.required !== true || !field.redaction.evidenceField) {
          fail(errors, `${base}.redaction`, "must require redaction evidence");
        }
      }
    }
    if (blockedCount === 0) {
      fail(errors, "$.fields", "must include at least one AI_BLOCKED field");
    }
    if (redactCount === 0) {
      fail(errors, "$.fields", "must include at least one AI_ALLOWED_WITH_REDACTION field");
    }
  }

  for (const [index, example] of (policy.providerPayloadExamples ?? []).entries()) {
    const result = validatePayloadAgainstPolicy(policy, example.payload ?? {});
    if (!result.ok) {
      for (const error of result.errors) {
        fail(errors, `$.providerPayloadExamples[${index}]`, error);
      }
    }
  }

  for (const [index, example] of (policy.blockedPayloadExamples ?? []).entries()) {
    const result = validatePayloadAgainstPolicy(policy, example.payload ?? {}, { expectValid: false });
    if (result.ok) {
      fail(errors, `$.blockedPayloadExamples[${index}]`, "blocked example unexpectedly passed");
    }
  }

  return { ok: errors.length === 0, errors };
}

function runCli() {
  const policy = readJson();
  const result = validatePolicy(policy);
  if (!result.ok) {
    console.error("AI-POL-001 provider payload policy validation failed:");
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(
    `AI-POL-001 provider payload policy validation passed: ${policy.fields.length} fields, ${policy.providerPayloadExamples.length} allowed examples, ${policy.blockedPayloadExamples.length} blocked examples.`,
  );
}

if (require.main === module) {
  runCli();
}

module.exports = {
  CLASSIFICATIONS,
  DEFAULT_POLICY,
  readJson,
  validatePayloadAgainstPolicy,
  validatePolicy,
};
