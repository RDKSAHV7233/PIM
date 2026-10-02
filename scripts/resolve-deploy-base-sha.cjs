#!/usr/bin/env node
/* eslint-disable no-console */
// Resolves the commit that the next deploy should diff against: the head SHA of the last
// SUCCESSFUL push deploy of `main` (DEF-PC-021). Diffing against the previous push instead
// loses changes whenever a queued deploy run is cancelled by a newer push, so a merged
// web-only change could silently never reach production.
//
// Prints the SHA, or nothing when it cannot be determined. Empty output makes
// railway-deploy.cjs deploy BOTH services (the fail-safe), so this script never fails the job.

const childProcess = require("node:child_process");

/**
 * @param {Array<{id:number,created_at?:string,head_sha:string,head_branch?:string,event?:string,conclusion?:string}>} runs
 *   workflow runs in any order (the API order is not reliable: it has returned old runs first)
 * @param {{currentRunId?: string|number, branch?: string}} options
 * @returns {string} head SHA of the newest successful push run on the branch, or "" if none
 */
function pickDeployBaseSha(runs, options = {}) {
  const branch = options.branch ?? "main";
  const currentRunId = String(options.currentRunId ?? "");
  if (!Array.isArray(runs)) {
    return "";
  }
  // Newest first by creation time; id breaks ties. Never trust the order the API returns.
  const newestFirst = [...runs].sort((a, b) => {
    const delta = Date.parse(b?.created_at ?? "") - Date.parse(a?.created_at ?? "");
    return Number.isNaN(delta) || delta === 0 ? Number(b?.id ?? 0) - Number(a?.id ?? 0) : delta;
  });
  for (const run of newestFirst) {
    if (!run || typeof run.head_sha !== "string" || !/^[0-9a-f]{40}$/i.test(run.head_sha)) {
      continue;
    }
    if (String(run.id) === currentRunId) {
      continue;
    }
    // Only push-triggered runs deploy everything changed since their own base; a manual
    // dispatch may have deployed a single service and must not count as "all deployed".
    if (run.event !== "push" || run.conclusion !== "success" || run.head_branch !== branch) {
      continue;
    }
    return run.head_sha.toLowerCase();
  }
  return "";
}

function isAncestorOfHead(sha, cwd, spawn = childProcess.spawnSync) {
  const result = spawn("git", ["merge-base", "--is-ancestor", sha, "HEAD"], { cwd, encoding: "utf8" });
  return result.status === 0;
}

// NOTE: query WITHOUT the `status=`/`event=` filters and filter client-side: with them GitHub intermittently
// returned stale, old-first result sets (observed 2026-10-03: identical calls gave different bases). The API can
// still answer with a stale list; that is safe by construction: a stale answer is an OLDER successful push deploy,
// i.e. a larger diff, so at worst an extra service is deployed, never one skipped.
function main(env = process.env, spawn = childProcess.spawnSync) {
  const repo = String(env.GITHUB_REPOSITORY ?? "").trim();
  if (!repo) {
    console.error("[resolve-deploy-base-sha] GITHUB_REPOSITORY is not set; deploying both services.");
    return "";
  }
  const result = spawn(
    "gh",
    [
      "api",
      `repos/${repo}/actions/workflows/deploy-staging.yml/runs?branch=main&per_page=50`,
      "--jq",
      ".workflow_runs",
    ],
    { encoding: "utf8", env },
  );
  if (result.error || result.status !== 0) {
    console.error(`[resolve-deploy-base-sha] run lookup failed; deploying both services. ${(result.stderr ?? "").trim()}`);
    return "";
  }
  let runs;
  try {
    runs = JSON.parse(result.stdout);
  } catch {
    console.error("[resolve-deploy-base-sha] unparseable run list; deploying both services.");
    return "";
  }
  const sha = pickDeployBaseSha(runs, { currentRunId: env.GITHUB_RUN_ID });
  if (!sha) {
    console.error("[resolve-deploy-base-sha] no prior successful push deploy; deploying both services.");
    return "";
  }
  if (!isAncestorOfHead(sha, process.cwd(), spawn)) {
    console.error(`[resolve-deploy-base-sha] ${sha} is not an ancestor of HEAD; deploying both services.`);
    return "";
  }
  return sha;
}

if (require.main === module) {
  process.stdout.write(main());
}

module.exports = { pickDeployBaseSha, main };
