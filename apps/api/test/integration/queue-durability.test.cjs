#!/usr/bin/env node
/* eslint-disable no-console */
const path = require("node:path");
const { createClient } = require("redis");
const { RedisMemoryServer } = require("redis-memory-server");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const QUEUE_SERVICE_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "queue", "queue.service.js");
const QUEUE_CONSTANTS_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "queue", "queue.constants.js");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate, timeoutMs, label) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await predicate()) {
      return;
    }
    await sleep(25);
  }
  throw new Error(`Timeout waiting for ${label}`);
}

async function withRedis(url, fn) {
  const client = createClient({ url });
  client.on("error", () => undefined);
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.quit().catch(() => undefined);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function run() {
  const { QueueService } = require(QUEUE_SERVICE_ENTRY);
  const { QUEUE_NAMES } = require(QUEUE_CONSTANTS_ENTRY);
  const redisServer = new RedisMemoryServer();
  await redisServer.start();

  const redisHost = await redisServer.getHost();
  const redisPort = await redisServer.getPort();
  const redisUrl = `redis://${redisHost}:${redisPort}`;
  process.env.REDIS_URL = redisUrl;
  process.env.QUEUE_BACKEND = "bullmq";

  try {
    await withRedis(redisUrl, async (redis) => {
      await redis.flushDb();

    process.env.QUEUE_WORKER_ENABLED = "false";
    const producerQueue = new QueueService();
    producerQueue.processWithBackpressure(
      QUEUE_NAMES.CONNECTOR_SUBMISSION,
      {
        laneResolver: (payload) => payload.connectorSlug,
        defaultLanePolicy: {
          concurrency: 1,
          minIntervalMs: 0,
          rateLimitFailureThreshold: 3,
          pauseDurationMs: 250,
        },
      },
      async () => {
        throw new Error("producer queue should not process jobs while worker is disabled");
      },
    );

    await producerQueue.enqueue(QUEUE_NAMES.CONNECTOR_SUBMISSION, {
      id: "persisted-job",
      connectorSlug: "flipkart",
    });

    await producerQueue.onModuleDestroy();

    const processed = [];
    process.env.QUEUE_WORKER_ENABLED = "true";
    const consumerQueue = new QueueService();
    consumerQueue.processWithBackpressure(
      QUEUE_NAMES.CONNECTOR_SUBMISSION,
      {
        laneResolver: (payload) => payload.connectorSlug,
        defaultLanePolicy: {
          concurrency: 1,
          minIntervalMs: 0,
          rateLimitFailureThreshold: 3,
          pauseDurationMs: 250,
        },
      },
      async (payload) => {
        processed.push(String(payload.id));
      },
    );

    await waitFor(() => processed.includes("persisted-job"), 10_000, "redis-backed job recovery after restart");

    const metrics = await consumerQueue.getMetrics();
    const connectorMetrics = metrics[QUEUE_NAMES.CONNECTOR_SUBMISSION];
    assert(Boolean(connectorMetrics), "Expected connector queue metrics to be present.");
    assert(connectorMetrics.waiting === 0, `Expected no waiting jobs after durable replay, got ${connectorMetrics.waiting}`);
    assert(consumerQueue.getBackend() === "bullmq", `Expected bullmq backend, got ${String(consumerQueue.getBackend())}`);
    assert(consumerQueue.isWorkerEnabled() === true, "Expected worker-enabled durable queue instance.");

    await consumerQueue.onModuleDestroy();
    await redis.flushDb();
    });
  } finally {
    await redisServer.stop();
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: ["redis_backed_jobs_survive_queue_restart", "bullmq_backend_metrics_exposed"],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

run().catch((error) => {
  console.error("Queue durability integration test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
