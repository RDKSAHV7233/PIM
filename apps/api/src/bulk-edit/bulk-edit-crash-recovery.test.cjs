#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const SERVICE = path.join(__dirname, "bulk-edit.service.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(SERVICE, "utf8");

  // 1. The queue handler must wrap processApplyJob in try/catch
  assert(
    source.includes("try {") &&
      source.includes("this.processApplyJob(payload)") &&
      source.includes("} catch (error)"),
    "Queue handler must wrap processApplyJob in try/catch to handle crashes.",
  );

  // 2. On crash, the operation must be marked as failed
  assert(
    source.includes("BulkEditOperationStatus.failed") &&
      source.match(/catch\s*\(error\)[\s\S]*?BulkEditOperationStatus\.failed/),
    "Crash handler must mark the operation as failed in the database.",
  );

  // 3. The error must be re-thrown so BullMQ records the job failure
  const catchBlock = source.match(/catch\s*\(error\)\s*\{([\s\S]*?)\n\s{8}\}/);
  assert(
    catchBlock && catchBlock[1].includes("throw error"),
    "Crash handler must re-throw the error so BullMQ records the job failure.",
  );

  // 4. The crash handler must log the error
  assert(
    source.match(/catch\s*\(error\)[\s\S]*?this\.logger\.error/),
    "Crash handler must log the error before marking failed.",
  );

  // 5. The DB update in the crash handler must be wrapped in its own try/catch
  //    (so a DB failure in the recovery path doesn't mask the original error)
  const innerCatch = source.match(
    /BulkEditOperationStatus\.failed[\s\S]*?catch\s*\{[\s\S]*?Failed to mark operation/,
  );
  assert(
    innerCatch,
    "DB update in crash handler must have its own try/catch to avoid masking the original error.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "queue_handler_wraps_processing_in_try_catch",
          "crash_marks_operation_as_failed",
          "error_is_rethrown_for_bullmq",
          "crash_is_logged",
          "recovery_db_update_has_inner_try_catch",
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

try {
  run();
} catch (error) {
  console.error("Bulk edit crash recovery test FAILED:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
