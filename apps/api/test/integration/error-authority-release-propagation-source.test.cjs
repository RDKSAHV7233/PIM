#!/usr/bin/env node
/* eslint-disable no-console */
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const ROOT_NODE_MODULES = "/mnt/c/Users/bhoiv/PIM1/node_modules";
const TS_NODE_REGISTER = path.join(ROOT_NODE_MODULES, "ts-node", "register", "transpile-only");
const EXPECTED_RELEASE = "260a89cc3475152d27821ae2334389ae88084f67";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const script = `
const apiEnv = require("./apps/api/src/common/error-authority-env.ts");
const webEnv = require("./apps/web/src/lib/server/error-authority-env.ts");
const expectedRelease = ${JSON.stringify(EXPECTED_RELEASE)};
const env = {
  APP_ENV: "staging",
  ERROR_AUTHORITY_ENABLED: "true",
  ERROR_AUTHORITY_RELEASE: expectedRelease,
  ERROR_AUTHORITY_INGEST_TOKEN: "configured-but-not-printed-minimum-32",
};
const apiRelease = apiEnv.resolveErrorAuthorityRelease(env);
const workerRelease = apiEnv.resolveErrorAuthorityRelease({ ...env, QUEUE_WORKER_ENABLED: "true" });
const nextServerRelease = webEnv.resolveErrorAuthorityRelease(env);
webEnv.assertTrustedErrorAuthorityServerIngestionConfig(env);
if (apiRelease !== expectedRelease) throw new Error("API release mismatch");
if (workerRelease !== expectedRelease) throw new Error("Worker release mismatch");
if (nextServerRelease !== expectedRelease) throw new Error("Next server release mismatch");
console.log(JSON.stringify({
  status: "ok",
  expectedRelease,
  api: "PASS",
  worker: "PASS",
  nextServer: "PASS",
  allSameRelease: apiRelease === workerRelease && workerRelease === nextServerRelease,
  ingestTokenConfigured: Boolean(env.ERROR_AUTHORITY_INGEST_TOKEN),
  tokenValuePrinted: false
}));
`.trim();

try {
  const result = spawnSync("node", ["-r", TS_NODE_REGISTER, "-e", script], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      NODE_PATH: ROOT_NODE_MODULES,
      TS_NODE_COMPILER_OPTIONS: '{ "module": "CommonJS", "moduleResolution": "Node", "jsx": "react-jsx" }',
    },
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
  });
  const output = `${result.stdout}\n${result.stderr}`;
  assert(result.status === 0, `release propagation source proof failed. Output tail: ${output.slice(-1000)}`);
  assert(output.includes(EXPECTED_RELEASE), "proof output must include the expected release SHA");
  assert(!output.includes("configured-but-not-printed-minimum-32"), "proof output must not print the ingest token value");
  const jsonLine = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .find((line) => line.startsWith("{"));
  const payload = JSON.parse(jsonLine);
  assert(payload.allSameRelease === true, "all runtimes must resolve the same release");
  assert(payload.ingestTokenConfigured === true, "proof must confirm ingest token is configured without printing it");
  assert(payload.tokenValuePrinted === false, "proof must explicitly avoid printing token value");
  console.log("Error Authority release propagation source proof passed.");
} catch (error) {
  console.error("Error Authority release propagation source proof failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
