import * as assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { test } from "node:test";

const REPO_ROOT = path.resolve(__dirname, "../../../..");

type ScriptJson = Record<string, unknown> & {
  validated?: string[];
};

function parseTailJson(stdout: string): ScriptJson {
  const trimmed = stdout.trim();
  const start = trimmed.lastIndexOf("{");
  if (start < 0) {
    throw new Error(`No JSON payload found in script output:\n${stdout}`);
  }
  const payload = trimmed.slice(start);
  return JSON.parse(payload) as ScriptJson;
}

function runScript(scriptName: string): ScriptJson {
  const stdout = execFileSync("npm.cmd", ["run", scriptName], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return parseTailJson(stdout);
}

function validatedIncludes(payload: ScriptJson, marker: string): void {
  const markers = Array.isArray(payload.validated) ? payload.validated : [];
  assert.ok(
    markers.includes(marker),
    `Expected marker '${marker}' in validated[] but got: ${JSON.stringify(markers)}`,
  );
}

test("P5-S4 gate: stable idempotency key for logical publish operation", () => {
  const payload = runScript("test:integration:connector-idempotency-semantics");
  validatedIncludes(payload, "stable_idempotency_key_jobid_operation");
});

test("P5-S4 gate: retry increments attempt counter without duplicate submissions", () => {
  const payload = runScript("test:integration:connector-idempotency-semantics");
  validatedIncludes(payload, "attempt_number_increments_separately");
  validatedIncludes(payload, "no_duplicate_submission_rows_for_retries");
});

test("P5-S5 gate: webhook dedupe rejects duplicate event in same installation scope", () => {
  const payload = runScript("test:integration:webhook-dedupe-scope");
  validatedIncludes(payload, "same_installation_duplicate_event_id_rejected");
});

test("P5-S5 gate: webhook dedupe allows same event id across installations", () => {
  const payload = runScript("test:integration:webhook-dedupe-scope");
  validatedIncludes(payload, "cross_installation_same_event_id_allowed");
});
