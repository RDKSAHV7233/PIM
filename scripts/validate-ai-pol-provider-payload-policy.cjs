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
const VECTORS_PATH = path.resolve(__dirname, "..", "test-fixtures", "ai-policy", "path-semantics.v1.json");
const PATH_SEGMENT = /^[A-Za-z0-9_-]+$/;
const PRECEDENCE = { AI_ALLOWED: 0, AI_ALLOWED_WITH_REDACTION: 1, AI_BLOCKED: 2 };
const SECRET_LIKE_KEY = /(secret|token|passw(or)?d|credential|apikey|accesskey|privatekey|bearer|oauth|authorization)/;
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

// ---- explicit path semantics (CommonJS port of apps/api/src/intelligence/intelligence-payload-policy.ts) ----
// Both implementations must satisfy test-fixtures/ai-policy/path-semantics.v1.json.

function validateRulePath(rulePath) {
  if (typeof rulePath !== "string" || rulePath.length === 0) {
    return "rule path is required";
  }
  const segments = rulePath.split(".");
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (segment === "*" || segment === "**") {
      if (index !== segments.length - 1) {
        return "a wildcard is only allowed as the last segment";
      }
      if (segments.length === 1) {
        return "a wildcard needs a parent path";
      }
      continue;
    }
    if (!PATH_SEGMENT.test(segment)) {
      return "segments may only contain letters, digits, underscore and hyphen";
    }
  }
  return null;
}

function parseRule(rulePath, classification) {
  if (validateRulePath(rulePath) !== null) {
    return null;
  }
  const segments = rulePath.split(".");
  const tail = segments[segments.length - 1];
  const kind = tail === "**" ? "subtree" : tail === "*" ? "children" : "exact";
  return { path: rulePath, kind, base: kind === "exact" ? segments : segments.slice(0, -1), classification };
}

function ruleMatches(rule, leaf) {
  const { base } = rule;
  if (rule.kind === "exact") {
    return leaf.length === base.length && base.every((segment, index) => segment === leaf[index]);
  }
  if (!base.every((segment, index) => segment === leaf[index])) {
    return false;
  }
  return rule.kind === "children" ? leaf.length === base.length + 1 : leaf.length > base.length;
}

function resolveLeaf(rules, leaf) {
  const matched = rules.filter((rule) => ruleMatches(rule, leaf));
  if (matched.length === 0) {
    return { matched, effective: null };
  }
  const effective = matched.reduce((winner, rule) => (PRECEDENCE[rule.classification] > PRECEDENCE[winner] ? rule.classification : winner), "AI_ALLOWED");
  return { matched, effective };
}

function isSecretLikeKey(segment) {
  return SECRET_LIKE_KEY.test(String(segment).toLowerCase().replace(/[_-]/g, ""));
}

function isValidPayloadSegment(segment) {
  return PATH_SEGMENT.test(segment);
}

function payloadLeaves(value, prefix = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return prefix.length > 0 ? [{ segments: prefix, value }] : [];
  }
  return Object.entries(value).flatMap(([key, child]) => payloadLeaves(child, [...prefix, key]));
}

/** Leaf-by-leaf classification with the explicit semantics. Returns the leaves that would be blocked. */
function blockedLeaves(policy, payload) {
  const rules = policy.fields.map((field) => parseRule(field.path, field.classification)).filter(Boolean);
  const redacted = Array.isArray(payload.redactedFields) ? payload.redactedFields.map(String) : [];
  const { redactedFields: _evidence, ...classifiable } = payload;
  const blocked = [];
  for (const leaf of payloadLeaves(classifiable)) {
    const label = leaf.segments.join(".");
    if (!leaf.segments.every(isValidPayloadSegment)) {
      blocked.push(label);
      continue;
    }
    const { matched, effective } = resolveLeaf(rules, leaf.segments);
    if (effective === null || effective === "AI_BLOCKED") {
      blocked.push(label);
    } else if (effective === "AI_ALLOWED_WITH_REDACTION" && !redacted.includes(label)) {
      blocked.push(label);
    } else if (matched.some((rule) => rule.kind !== "exact" && leaf.segments.slice(rule.base.length).some(isSecretLikeKey))) {
      blocked.push(label);
    } else if (typeof leaf.value === "string" && SECRET_VALUE_PATTERN.test(leaf.value)) {
      blocked.push(label);
    } else if (Array.isArray(leaf.value) && leaf.value.some((element) => (element && typeof element === "object") || (typeof element === "string" && SECRET_VALUE_PATTERN.test(element)))) {
      blocked.push(label);
    }
  }
  return blocked;
}

function validatePathSemanticsVectors(vectors) {
  const errors = [];
  for (const valid of vectors.ruleGrammar.valid) {
    if (validateRulePath(valid) !== null) fail(errors, "ruleGrammar.valid", `${JSON.stringify(valid)} was rejected`);
  }
  for (const invalid of vectors.ruleGrammar.invalid) {
    if (validateRulePath(invalid) === null) fail(errors, "ruleGrammar.invalid", `${JSON.stringify(invalid)} was accepted`);
  }
  for (const valid of vectors.payloadSegments.valid) {
    if (!isValidPayloadSegment(valid)) fail(errors, "payloadSegments.valid", `${JSON.stringify(valid)} was rejected`);
  }
  for (const invalid of vectors.payloadSegments.invalid) {
    if (isValidPayloadSegment(invalid)) fail(errors, "payloadSegments.invalid", `${JSON.stringify(invalid)} was accepted`);
  }
  for (const key of vectors.secretLikeKeys.secret) {
    if (!isSecretLikeKey(key)) fail(errors, "secretLikeKeys.secret", `${key} was not flagged`);
  }
  for (const key of vectors.secretLikeKeys.notSecret) {
    if (isSecretLikeKey(key)) fail(errors, "secretLikeKeys.notSecret", `${key} was flagged`);
  }
  for (const vector of vectors.resolution) {
    const rules = vector.rules.map(([rulePath, classification]) => parseRule(rulePath, classification));
    if (rules.some((rule) => rule === null)) {
      fail(errors, `resolution.${vector.id}`, "vector contains an invalid rule");
      continue;
    }
    const result = resolveLeaf(rules, vector.leaf.split("."));
    if (JSON.stringify(result.matched.map((rule) => rule.path)) !== JSON.stringify(vector.matched) || result.effective !== vector.effective) {
      fail(errors, `resolution.${vector.id}`, `expected ${JSON.stringify(vector.matched)}/${vector.effective}, got ${JSON.stringify(result.matched.map((rule) => rule.path))}/${result.effective}`);
    }
  }
  return { ok: errors.length === 0, errors };
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
      if (typeof field.path === "string") {
        const invalidReason = validateRulePath(field.path);
        if (invalidReason) {
          fail(errors, `${base}.path`, `invalid rule path: ${invalidReason}`);
        }
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
    // The example must also be classifiable leaf by leaf under the explicit path semantics.
    for (const leaf of blockedLeaves(policy, example.payload ?? {})) {
      fail(errors, `$.providerPayloadExamples[${index}]`, `leaf ${leaf} would be blocked under the explicit path semantics`);
    }
  }

  for (const [index, example] of (policy.blockedPayloadExamples ?? []).entries()) {
    const result = validatePayloadAgainstPolicy(policy, example.payload ?? {}, { expectValid: false });
    if (result.ok) {
      fail(errors, `$.blockedPayloadExamples[${index}]`, "blocked example unexpectedly passed");
    }
    if (blockedLeaves(policy, example.payload ?? {}).length === 0) {
      fail(errors, `$.blockedPayloadExamples[${index}]`, "blocked example has no blocked leaf under the explicit path semantics");
    }
  }

  return { ok: errors.length === 0, errors };
}

function runCli() {
  const policy = readJson();
  const vectorResult = validatePathSemanticsVectors(readJson(VECTORS_PATH));
  if (!vectorResult.ok) {
    console.error("AI-POL-002 path semantics vectors failed:");
    for (const error of vectorResult.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }
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
  VECTORS_PATH,
  blockedLeaves,
  isSecretLikeKey,
  readJson,
  resolveLeaf,
  validatePathSemanticsVectors,
  validateRulePath,
  validatePayloadAgainstPolicy,
  validatePolicy,
};
