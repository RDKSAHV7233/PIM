#!/usr/bin/env node
/* eslint-disable no-console */

"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");

const LARGE_PR_APPROVAL_LABEL = "cto-large-pr-approved";
const MAX_CHANGED_FILES = 60;
const MAX_CHANGED_LINES = 2500;
const MAX_CROSS_DOMAIN_FILES = 25;
const MAX_RISK_DOMAINS = 3;

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

function summarizeScope(entries) {
  const files = entries.map((entry) => normalizePath(entry.file)).filter(Boolean);
  const changedLines = entries.reduce((total, entry) => total + entry.additions + entry.deletions, 0);
  return {
    changedFiles: files.length,
    changedLines,
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

  console.log(
    `[pr-scope] files=${summary.changedFiles} lines=${summary.changedLines} domains=${summary.domains.join(",") || "none"}`,
  );

  if (evaluation.ok) {
    if (evaluation.reasons.length > 0) {
      console.log(`[pr-scope] large PR approval accepted via '${LARGE_PR_APPROVAL_LABEL}' or PR_SCOPE_ALLOW_LARGE=true.`);
    }
    return;
  }

  console.error("[pr-scope] PR is too broad for the default review lane:");
  for (const reason of evaluation.reasons) {
    console.error(`- ${reason}`);
  }
  console.error(
    `[pr-scope] Split the PR by risk domain, or add the '${LARGE_PR_APPROVAL_LABEL}' label after explicit CTO review.`,
  );
  process.exitCode = 1;
}

if (require.main === module) {
  main(process.env);
}

module.exports = {
  LARGE_PR_APPROVAL_LABEL,
  classifyDomains,
  evaluateScope,
  hasLargePrApproval,
  parseNumstat,
  summarizeScope,
};
