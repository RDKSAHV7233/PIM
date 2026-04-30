#!/usr/bin/env node
/* eslint-disable no-console */
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const TEST_DIR = __dirname;
const tests = fs
  .readdirSync(TEST_DIR)
  .filter((file) => file.endsWith(".test.cjs"))
  .sort();

const failed = [];

for (const test of tests) {
  console.log(`WEBTEST_START ${test}`);
  const result = spawnSync(process.execPath, [path.join(TEST_DIR, test)], {
    cwd: path.resolve(TEST_DIR, "../../../.."),
    encoding: "utf8",
    stdio: "pipe",
  });

  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  if (result.stderr) {
    process.stderr.write(result.stderr);
  }

  if (result.status === 0) {
    console.log(`WEBTEST_PASS ${test}`);
  } else {
    failed.push(test);
    console.log(`WEBTEST_FAIL ${test} EXIT ${result.status ?? "null"}`);
  }
}

console.log(`WEBTEST_SUMMARY total=${tests.length} failed=${failed.length}`);
if (failed.length > 0) {
  console.log(`WEBTEST_FAILED ${failed.join(",")}`);
  process.exit(1);
}
