#!/usr/bin/env node
/* eslint-disable no-console */
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const QUEUE_SERVICE_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "queue", "queue.service.js");
const QUEUE_CONSTANTS_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "queue", "queue.constants.js");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) {
      return;
    }
    await sleep(10);
  }
  throw new Error(`Timeout waiting for ${label}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function run() {
  process.env.QUEUE_BACKEND = "memory";
  process.env.QUEUE_WORKER_ENABLED = "true";
  const { QueueService, QueueRateLimitError } = require(QUEUE_SERVICE_ENTRY);
  const { QUEUE_NAMES } = require(QUEUE_CONSTANTS_ENTRY);

  const queue = new QueueService();

  const activeByLane = {};
  const maxActiveByLane = {};
  const startedAtByJob = {};
  const processedJobs = [];
  const rateLimitFailureAt = [];
  const circuitEvents = [];

  queue.processWithBackpressure(
    QUEUE_NAMES.CONNECTOR_SUBMISSION,
    {
      laneResolver: (payload) => payload.connectorSlug,
      defaultLanePolicy: {
        concurrency: 1,
        minIntervalMs: 50,
        rateLimitFailureThreshold: 3,
        pauseDurationMs: 250,
      },
      lanePolicies: {
        amazon: {
          concurrency: 1,
          minIntervalMs: 80,
          rateLimitFailureThreshold: 3,
          pauseDurationMs: 250,
        },
        flipkart: {
          concurrency: 2,
          minIntervalMs: 0,
          rateLimitFailureThreshold: 3,
          pauseDurationMs: 250,
        },
      },
      onCircuitOpen: (event) => {
        circuitEvents.push({ ...event, observedAt: Date.now() });
      },
    },
    async (payload) => {
      const lane = String(payload.connectorSlug);
      const now = Date.now();
      startedAtByJob[payload.id] = now;
      activeByLane[lane] = (activeByLane[lane] ?? 0) + 1;
      maxActiveByLane[lane] = Math.max(maxActiveByLane[lane] ?? 0, activeByLane[lane]);
      await sleep(30);
      activeByLane[lane] -= 1;
      if (payload.rateLimit === true) {
        rateLimitFailureAt.push(Date.now());
        throw new QueueRateLimitError("429 from connector");
      }
      processedJobs.push(payload.id);
    },
  );

  for (let index = 1; index <= 5; index += 1) {
    await queue.enqueue(QUEUE_NAMES.CONNECTOR_SUBMISSION, {
      id: `amazon_${index}`,
      connectorSlug: "amazon",
    });
  }
  for (let index = 1; index <= 4; index += 1) {
    await queue.enqueue(QUEUE_NAMES.CONNECTOR_SUBMISSION, {
      id: `flipkart_${index}`,
      connectorSlug: "flipkart",
    });
  }

  await waitFor(() => processedJobs.length >= 9, 10_000, "base queue processing");

  assert(
    (maxActiveByLane.amazon ?? 0) <= 1,
    `Expected amazon lane max concurrency <=1, got ${String(maxActiveByLane.amazon ?? 0)}`,
  );
  assert(
    (maxActiveByLane.flipkart ?? 0) <= 2,
    `Expected flipkart lane max concurrency <=2, got ${String(maxActiveByLane.flipkart ?? 0)}`,
  );

  for (let index = 2; index <= 5; index += 1) {
    const prev = startedAtByJob[`amazon_${index - 1}`];
    const current = startedAtByJob[`amazon_${index}`];
    assert(Boolean(prev && current), `Missing amazon timing for amazon_${index}`);
    const spacing = current - prev;
    // The amazon lane policy is 80ms, the default lane policy 50ms. The timestamps are taken inside the handlers, so scheduler jitter
    // on a loaded runner (the lane runs several API processes at once) shifts them by tens of ms either way; 70ms was observed to
    // flake at 67ms. 60ms still proves the lane-specific 80ms interval is applied (it is above the 50ms default) without depending on
    // sub-10ms timer accuracy.
    assert(
      spacing >= 60,
      `Expected amazon lane spacing >=60ms, got ${spacing}ms between amazon_${index - 1} and amazon_${index}`,
    );
  }

  await queue.enqueue(QUEUE_NAMES.CONNECTOR_SUBMISSION, {
    id: "amazon_rl_1",
    connectorSlug: "amazon",
    rateLimit: true,
  });
  await queue.enqueue(QUEUE_NAMES.CONNECTOR_SUBMISSION, {
    id: "amazon_rl_2",
    connectorSlug: "amazon",
    rateLimit: true,
  });
  await queue.enqueue(QUEUE_NAMES.CONNECTOR_SUBMISSION, {
    id: "amazon_rl_3",
    connectorSlug: "amazon",
    rateLimit: true,
  });
  await queue.enqueue(QUEUE_NAMES.CONNECTOR_SUBMISSION, {
    id: "amazon_after_pause",
    connectorSlug: "amazon",
  });

  await waitFor(
    () =>
      rateLimitFailureAt.length >= 3 &&
      Object.prototype.hasOwnProperty.call(startedAtByJob, "amazon_after_pause"),
    10_000,
    "rate limit circuit behavior",
  );

  assert(circuitEvents.length >= 1, "Expected at least one circuit-open event.");
  const thirdFailureAt = rateLimitFailureAt[2];
  const afterPauseAt = startedAtByJob.amazon_after_pause;
  const pauseDelay = afterPauseAt - thirdFailureAt;
  assert(
    pauseDelay >= 200,
    `Expected paused execution delay >=200ms after rate-limit storm, got ${pauseDelay}ms`,
  );

  await waitFor(() => processedJobs.includes("amazon_after_pause"), 5_000, "post-pause processing");
  const metrics = await queue.getMetrics();
  const connectorQueueMetrics = metrics[QUEUE_NAMES.CONNECTOR_SUBMISSION];
  assert(Boolean(connectorQueueMetrics), "Expected connector queue metrics to be present.");
  assert(
    connectorQueueMetrics.waiting === 0,
    `Expected no waiting jobs after drain, got ${connectorQueueMetrics.waiting}`,
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "per_connector_concurrency_enforced",
          "per_connector_rate_limit_spacing_enforced",
          "rate_limit_storm_triggers_pause",
          "queue_metrics_exposed",
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

run().catch((error) => {
  console.error("Worker backpressure integration test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
