#!/usr/bin/env node
/* eslint-disable no-console */

"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");

const LARGE_PR_APPROVAL_LABEL = "cto-large-pr-approved";
const REQUIRED_TEAM_APPROVAL_LABEL = "cto-required-team-approved";
const MAX_CHANGED_FILES = 60;
const MAX_CHANGED_LINES = 2500;
const MAX_CROSS_DOMAIN_FILES = 25;
const MAX_RISK_DOMAINS = 3;

const GENERATED_FILE_PATTERNS = [
  "docs/openapi.json",
  "docs/openapi.yaml",
  "docs/vexa-pim.postman_collection.json",
];

const RISK_DOMAIN_MATCHERS = [
  ["ci", (file) => file.startsWith(".github/") || file.startsWith("scripts/")],
  ["api-auth", (file) => file.startsWith("apps/api/src/auth/")],
  ["api-product", (file) => file.startsWith("apps/api/src/") && !file.startsWith("apps/api/src/auth/")],
  ["api-tests", (file) => file.startsWith("apps/api/test/")],
  ["web", (file) => file.startsWith("apps/web/")],
  ["db", (file) => file.startsWith("packages/db/")],
  ["docs", (file) => file.startsWith("docs/") || file.endsWith(".md")],
];

function normalizePath(file) {
  return String(file ?? "").replace(/\\/g, "/").trim();
}

function parseNumstat(text) {
  return String(text ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [rawAdditions = "0", rawDeletions = "0", ...pathParts] = line.split("\t");
      return {
        additions: Number.parseInt(rawAdditions, 10) || 0,
        deletions: Number.parseInt(rawDeletions, 10) || 0,
        file: normalizePath(pathParts.join("\t")),
      };
    })
    .filter((entry) => entry.file);
}

function classifyDomains(files) {
  const domains = new Set();
  for (const rawFile of files) {
    const file = normalizePath(rawFile);
    for (const [name, matches] of RISK_DOMAIN_MATCHERS) {
      if (matches(file)) {
        domains.add(name);
      }
    }
  }
  return Array.from(domains).sort();
}

function isGenerated(file) {
  return GENERATED_FILE_PATTERNS.some((pattern) => normalizePath(file) === pattern);
}

function summarizeScope(entries) {
  const files = entries.map((entry) => normalizePath(entry.file)).filter(Boolean);
  const reviewableEntries = entries.filter((entry) => !isGenerated(entry.file));
  const changedLines = reviewableEntries.reduce((total, entry) => total + entry.additions + entry.deletions, 0);
  const generatedLines = entries.length - reviewableEntries.length;
  return {
    changedFiles: files.length,
    changedLines,
    generatedFilesExcluded: generatedLines,
    domains: classifyDomains(files),
  };
}

function readApprovalLabels(eventPath) {
  if (!eventPath || !fs.existsSync(eventPath)) {
    return [];
  }

  try {
    const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
    const labels = event?.pull_request?.labels;
    return Array.isArray(labels)
      ? labels.map((label) => String(label?.name ?? "").trim()).filter(Boolean)
      : [];
  } catch {
    return [];
  }
}

function hasLargePrApproval(labels, env = process.env) {
  return env.PR_SCOPE_ALLOW_LARGE === "true" || labels.includes(LARGE_PR_APPROVAL_LABEL);
}

function hasRequiredTeamApproval(labels, env = process.env) {
  return env.PR_SCOPE_ALLOW_REQUIRED_TEAM === "true" || labels.includes(REQUIRED_TEAM_APPROVAL_LABEL);
}

function isAuthOrSessionBoundaryPath(rawFile) {
  const file = normalizePath(rawFile);
  return (
    file.startsWith("apps/api/src/auth/") ||
    file.startsWith("apps/api/test/integration/auth-") ||
    file.startsWith("apps/api/test/integration/access-policy") ||
    file.startsWith("apps/api/test/integration/workspace-user") ||
    file.startsWith("apps/web/src/app/api/auth/") ||
    file.startsWith("apps/web/src/middleware") ||
    file.includes("jwt") ||
    file.includes("Jwt") ||
    file.includes("revocation") ||
    file.includes("token-blocklist")
  );
}

function isWooCommerceConnectorPath(rawFile) {
  const file = normalizePath(rawFile);
  return (
    file.startsWith("apps/api/src/connectors/woocommerce/") ||
    file.startsWith("apps/api/test/integration/woocommerce") ||
    file.startsWith("apps/web/src/app/channels/woocommerce") ||
    file.includes("/woocommerce/")
  );
}

function isRequiredTeamReviewPath(rawFile) {
  const file = normalizePath(rawFile);
  return (
    isAuthOrSessionBoundaryPath(file) ||
    isWooCommerceConnectorPath(file) ||
    file.startsWith("apps/api/src/common/rbac/") ||
    file.startsWith("apps/api/src/common/access-policy/") ||
    file.startsWith("apps/api/src/common/tenant/") ||
    file.startsWith("packages/db/prisma/migrations/") ||
    file.startsWith(".github/workflows/")
  );
}

function evaluateGovernance(entries, labels = [], env = process.env) {
  const files = entries.map((entry) => normalizePath(entry.file)).filter(Boolean);
  const touchesAuthOrSession = files.some(isAuthOrSessionBoundaryPath);
  const touchesWooCommerce = files.some(isWooCommerceConnectorPath);
  const requiredTeamFiles = files.filter(isRequiredTeamReviewPath);
  const requiredTeamApproved = hasRequiredTeamApproval(labels, env);
  const reasons = [];

  if (touchesAuthOrSession && touchesWooCommerce) {
    reasons.push(
      "WooCommerce connector changes and auth/session/revocation changes must be split into separate PRs",
    );
  }

  if (requiredTeamFiles.length > 0 && !requiredTeamApproved) {
    reasons.push(
      `${requiredTeamFiles.length} required-team file(s) touched without '${REQUIRED_TEAM_APPROVAL_LABEL}' approval`,
    );
  }

  return {
    requiredTeamApproved,
    requiredTeamFiles,
    ok: reasons.length === 0,
    reasons,
  };
}

function evaluateScope(summary, approved) {
  const reasons = [];

  if (summary.changedFiles > MAX_CHANGED_FILES) {
    reasons.push(`${summary.changedFiles} files exceeds the ${MAX_CHANGED_FILES}-file review bound`);
  }
  if (summary.changedLines > MAX_CHANGED_LINES) {
    reasons.push(`${summary.changedLines} changed lines exceeds the ${MAX_CHANGED_LINES}-line review bound`);
  }
  if (summary.changedFiles > MAX_CROSS_DOMAIN_FILES && summary.domains.length >= MAX_RISK_DOMAINS) {
    reasons.push(
      `${summary.changedFiles} files span ${summary.domains.length} risk domains (${summary.domains.join(", ")})`,
    );
  }

  return {
    approved,
    ok: reasons.length === 0 || approved,
    reasons,
  };
}

function gitNumstat(baseRef) {
  const result = childProcess.spawnSync("git", ["diff", "--numstat", `${baseRef}...HEAD`], {
    encoding: "utf8",
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(`git diff --numstat ${baseRef}...HEAD failed with exit code ${result.status}`);
  }
  return result.stdout;
}

function main(env = process.env) {
  const baseRef = String(env.GIT_BASE_REF ?? "").trim();
  if (!baseRef) {
    throw new Error("Missing GIT_BASE_REF for PR scope comparison.");
  }

  const entries = parseNumstat(gitNumstat(baseRef));
  const summary = summarizeScope(entries);
  const labels = readApprovalLabels(env.GITHUB_EVENT_PATH);
  const evaluation = evaluateScope(summary, hasLargePrApproval(labels, env));
  const governance = evaluateGovernance(entries, labels, env);

  const genNote = summary.generatedFilesExcluded > 0
    ? ` (${summary.generatedFilesExcluded} generated file(s) excluded from line count)`
    : "";
  console.log(
    `[pr-scope] files=${summary.changedFiles} lines=${summary.changedLines} domains=${summary.domains.join(",") || "none"}${genNote}`,
  );

  if (evaluation.ok && governance.ok) {
    if (evaluation.reasons.length > 0) {
      console.log(`[pr-scope] large PR approval accepted via '${LARGE_PR_APPROVAL_LABEL}' or PR_SCOPE_ALLOW_LARGE=true.`);
    }
    if (governance.requiredTeamApproved && governance.requiredTeamFiles.length > 0) {
      console.log(
        `[pr-scope] required-team approval accepted via '${REQUIRED_TEAM_APPROVAL_LABEL}' or PR_SCOPE_ALLOW_REQUIRED_TEAM=true.`,
      );
    }
    return;
  }

  console.error("[pr-scope] PR is outside the default review lane:");
  for (const reason of evaluation.reasons) {
    console.error(`- ${reason}`);
  }
  for (const reason of governance.reasons) {
    console.error(`- ${reason}`);
  }
  console.error(
    `[pr-scope] Split the PR by risk domain, or add the '${LARGE_PR_APPROVAL_LABEL}' label after explicit CTO review.`,
  );
  console.error(
    `[pr-scope] Security, tenant-boundary, auth/session, workflow, migration, or WooCommerce connector changes also require '${REQUIRED_TEAM_APPROVAL_LABEL}' approval.`,
  );
  process.exitCode = 1;
}

if (require.main === module) {
  main(process.env);
}

module.exports = {
  LARGE_PR_APPROVAL_LABEL,
  REQUIRED_TEAM_APPROVAL_LABEL,
  classifyDomains,
  evaluateGovernance,
  evaluateScope,
  hasLargePrApproval,
  hasRequiredTeamApproval,
  isAuthOrSessionBoundaryPath,
  isRequiredTeamReviewPath,
  isWooCommerceConnectorPath,
  parseNumstat,
  summarizeScope,
};
