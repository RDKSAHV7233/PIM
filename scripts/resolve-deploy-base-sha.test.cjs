#!/usr/bin/env node
/* eslint-disable no-console */
// DEF-PC-021: deploy targets must be diffed against the last SUCCESSFUL push deploy, so a
// cancelled queued run (a web-only change) is still included in the next deploy.

const assert = require("node:assert/strict");
const childProcess = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { pickDeployBaseSha } = require("./resolve-deploy-base-sha.cjs");
const { classifyDeployTargets, getChangedFiles } = require("./railway-deploy.cjs");

const sha = (c) => c.repeat(40);

function run(id, headSha, overrides = {}) {
  return { id, created_at: `2026-10-02T19:${String(id).padStart(2, "0")}:00Z`, head_sha: headSha, head_branch: "main", event: "push", conclusion: "success", ...overrides };
}

// --- pickDeployBaseSha -------------------------------------------------------------
assert.equal(pickDeployBaseSha([run(2, sha("b")), run(3, sha("c")), run(1, sha("a"))], {}), sha("c"), "API order is not trusted: newest by created_at wins even when listed oldest-first");
assert.equal(pickDeployBaseSha([run(3, sha("c")), run(2, sha("b"))], { currentRunId: 9 }), sha("c"), "newest successful push run wins");
assert.equal(pickDeployBaseSha([run(9, sha("c")), run(2, sha("b"))], { currentRunId: 9 }), sha("b"), "the current run is never its own base");
assert.equal(
  pickDeployBaseSha([run(5, sha("d"), { event: "workflow_dispatch" }), run(4, sha("a"))], { currentRunId: 9 }),
  sha("a"),
  "a manual dispatch (maybe single-service) is never used as the base",
);
assert.equal(pickDeployBaseSha([run(5, sha("d"), { conclusion: "cancelled" }), run(4, sha("a"), { conclusion: "failure" })], {}), "", "cancelled/failed runs are not bases");
assert.equal(pickDeployBaseSha([run(5, sha("d"), { head_branch: "feature" })], {}), "", "other branches are ignored");
assert.equal(pickDeployBaseSha([run(5, "not-a-sha")], {}), "", "malformed SHAs are ignored");
assert.equal(pickDeployBaseSha(undefined, {}), "", "garbage input -> no base");
assert.equal(pickDeployBaseSha([], {}), "", "no runs -> no base");

// --- main(): every failure path must print nothing (=> deploy both), never throw ----------
const { main } = require("./resolve-deploy-base-sha.cjs");
const quiet = (fn) => {
  const original = console.error;
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.error = original;
  }
};
const ENV = { GITHUB_REPOSITORY: "o/r", GITHUB_RUN_ID: "9" };
const gh = (stdout, status = 0) => (cmd) => (cmd === "gh" ? { status, stdout, stderr: "" } : { status: 0 });
assert.equal(quiet(() => main({}, gh("[]"))), "", "no repository -> no base");
assert.equal(quiet(() => main(ENV, () => ({ error: new Error("ENOENT") }))), "", "gh missing -> no base");
assert.equal(quiet(() => main(ENV, gh("", 1))), "", "gh failure (e.g. missing actions:read) -> no base");
assert.equal(quiet(() => main(ENV, gh("not json"))), "", "unparseable response -> no base");
assert.equal(quiet(() => main(ENV, gh("[]"))), "", "no runs -> no base");
assert.equal(main(ENV, gh(JSON.stringify([run(3, sha("c"))]))), sha("c"), "happy path returns the last successful push deploy");
assert.equal(
  quiet(() => main(ENV, (cmd) => (cmd === "gh" ? { status: 0, stdout: JSON.stringify([run(3, sha("c"))]) } : { status: 1 }))),
  "",
  "base that is not an ancestor of HEAD (force-push/rewrite) -> no base",
);

// --- replay of the 2026-10-02 incident on a real temp git repo ------------------------
const repo = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-base-"));
const git = (...args) => {
  const r = childProcess.spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  assert.equal(r.status, 0, `git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.trim();
};
function commit(file, message) {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.appendFileSync(path.join(repo, file), `${message}\n`);
  git("add", "-A");
  git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", message);
  return git("rev-parse", "HEAD");
}
git("init", "-q");
const lastDeployed = commit("apps/web/src/a.ts", "S1 web (deployed)");
commit("apps/web/src/b.tsx", "S2 web (run CANCELLED)");
commit("apps/api/src/c.ts", "S3 api (run CANCELLED)");
const head = commit("apps/api/src/d.ts", "S4 api (run succeeded, api only)");

const previousPush = git("rev-parse", "HEAD~1");
const buggy = classifyDeployTargets(getChangedFiles({ DEPLOY_BASE_SHA: previousPush, GITHUB_SHA: head }, repo));
assert.deepEqual(buggy, { deployApi: true, deployWeb: false }, "sanity: the previous-push base reproduces the incident (web skipped)");

const fixed = classifyDeployTargets(getChangedFiles({ DEPLOY_BASE_SHA: lastDeployed, GITHUB_SHA: head }, repo));
assert.deepEqual(fixed, { deployApi: true, deployWeb: true }, "last-successful-deploy base includes the cancelled web change");

// fail safe: no base -> everything deploys
assert.equal(getChangedFiles({ GITHUB_SHA: head }, repo), null, "no DEPLOY_BASE_SHA -> null (deploy both)");
assert.deepEqual(classifyDeployTargets(null), { deployApi: true, deployWeb: true }, "unknown diff deploys both services");
assert.equal(getChangedFiles({ DEPLOY_BASE_SHA: sha("f"), GITHUB_SHA: head }, repo), null, "unreachable base -> null (deploy both)");
// manual override still wins
assert.deepEqual(getChangedFiles({ RAILWAY_DEPLOY_TARGETS: "web", DEPLOY_BASE_SHA: lastDeployed, GITHUB_SHA: head }, repo), ["web"]);

fs.rmSync(repo, { recursive: true, force: true });
console.log("resolve-deploy-base-sha.test.cjs: PASS");
