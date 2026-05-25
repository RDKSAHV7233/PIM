#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const controllerSource = fs.readFileSync(path.join(REPO_ROOT, "apps/api/src/common/app.controller.ts"), "utf8");
const queueSource = fs.readFileSync(path.join(REPO_ROOT, "apps/api/src/queue/queue.service.ts"), "utf8");

assert(
  controllerSource.includes('@Get("queue/:queueName/lanes/:laneKey/failed")'),
  "admin queue failed-job diagnostics route is missing",
);
assert(
  controllerSource.includes('@AuthenticatedReadRoute({ classification: "admin_only"') &&
    controllerSource.includes('@AdminBoundaryAccess({ capability: "manage_security" })') &&
    controllerSource.includes('@Roles("admin")'),
  "failed-job diagnostics route must stay admin-only and read-policy classified",
);
assert(
  queueSource.includes("export interface QueueFailedJobSummary") &&
    queueSource.includes("failedReason: string | null;") &&
    queueSource.includes("attemptsMade: number;"),
  "failed-job diagnostics must expose bounded operational metadata",
);
assert(
  queueSource.includes("failedReason: this.truncateDiagnostic(job.failedReason)") &&
    !queueSource.includes("data: job.data"),
  "failed-job diagnostics must not expose queue payload data",
);

console.log(
  JSON.stringify(
    {
      status: "ok",
      validated: [
        "admin_queue_failed_job_route_present",
        "queue_failed_job_route_admin_only",
        "queue_failed_job_metadata_bounded",
        "queue_failed_job_payload_not_exposed",
      ],
    },
    null,
    2,
  ),
);
