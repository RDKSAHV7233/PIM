import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import type { Job as BullJob, Queue as BullQueue, Worker } from "bullmq";
import type { RedisClientType } from "redis";
import { ErrorCaptureService } from "../error-authority/error-capture.service";
import { classifyWorkerError, extractSafePayloadRef, isTerminalBullFailure } from "../error-authority/worker-error-classifier";
import { QueueName } from "./queue.constants";

type QueueHandler<T = unknown> = (payload: T) => Promise<void> | void;

type QueueBackend = "memory" | "bullmq";

export interface QueueLanePolicy {
  concurrency: number;
  minIntervalMs: number;
  rateLimitFailureThreshold: number;
  pauseDurationMs: number;
}

export interface QueueCircuitOpenEvent {
  queueName: string;
  laneKey: string;
  pauseUntil: string;
}

export interface QueueBackpressureOptions<T = unknown> {
  laneResolver?: (payload: T) => string;
  defaultLanePolicy?: Partial<QueueLanePolicy>;
  lanePolicies?: Record<string, Partial<QueueLanePolicy>>;
  isRateLimitError?: (error: unknown) => boolean;
  onCircuitOpen?: (event: QueueCircuitOpenEvent) => void;
  onHandlerError?: (event: QueueHandlerErrorEvent<T>) => void;
}

export interface QueueHandlerErrorEvent<T = unknown> {
  queueName: string;
  laneKey: string;
  payload: T;
  errorMessage: string;
}

export class QueueRateLimitError extends Error {
  constructor(message = "rate_limit_exceeded") {
    super(message);
    this.name = "QueueRateLimitError";
  }
}

export interface QueueMetrics {
  waiting: number;
  active: number;
  failed: number;
  pausedLanes: number;
  lanes: Record<
    string,
    {
      waiting: number;
      active: number;
      failed: number;
      pausedUntil: string | null;
    }
  >;
}

export interface QueueFailedJobSummary {
  id: string;
  name: string;
  failedReason: string | null;
  attemptsMade: number;
  timestamp: string | null;
  processedOn: string | null;
  finishedOn: string | null;
}

type MemoryQueueRegistration = {
  kind: "memory";
  handler: QueueHandler<unknown>;
  options: QueueBackpressureOptions<unknown>;
  lanes: Map<string, MemoryLaneState>;
};

type MemoryLaneState = {
  pending: unknown[];
  active: number;
  scheduled: boolean;
  pausedUntilMs: number | null;
  lastStartAtMs: number;
  consecutiveRateLimitFailures: number;
  timer: NodeJS.Timeout | null;
};

type BullQueueRegistration = {
  kind: "bullmq";
  handler: QueueHandler<unknown>;
  options: QueueBackpressureOptions<unknown>;
  lanes: Map<string, BullLaneState>;
};

type BullLaneState = {
  queue: BullQueue<unknown>;
  worker: Worker<unknown, void, string> | null;
  active: number;
  pausedUntilMs: number | null;
  consecutiveRateLimitFailures: number;
  resumeTimer: NodeJS.Timeout | null;
  waiting: number;
};

type QueueRegistration = MemoryQueueRegistration | BullQueueRegistration;

type BullConnectionOptions = {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
  tls?: Record<string, never>;
  maxRetriesPerRequest: null;
};

const DEFAULT_POLICY: QueueLanePolicy = {
  concurrency: Number.MAX_SAFE_INTEGER,
  minIntervalMs: 0,
  rateLimitFailureThreshold: Number.MAX_SAFE_INTEGER,
  pauseDurationMs: 0,
};

const DEFAULT_QUEUE_BACKEND: QueueBackend = "memory";
const DEFAULT_QUEUE_WORKER_ENABLED = true;
const DEFAULT_REDIS_URL = "redis://localhost:6379";

let bullmqModule: typeof import("bullmq") | null = null;
let redisModule: typeof import("redis") | null = null;

function resolveQueueBackend(): QueueBackend {
  const raw = String(process.env.QUEUE_BACKEND ?? DEFAULT_QUEUE_BACKEND).trim().toLowerCase();
  return raw === "bullmq" ? "bullmq" : "memory";
}

function resolveBooleanEnv(name: string, fallback: boolean): boolean {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (!raw) {
    return fallback;
  }
  return raw === "true";
}

function buildBullConnectionOptions(redisUrlInput: string): BullConnectionOptions {
  const parsed = new URL(redisUrlInput);
  const dbText = parsed.pathname.replace(/^\//, "").trim();
  const db = dbText ? Number.parseInt(dbText, 10) : 0;
  return {
    host: parsed.hostname,
    port: parsed.port ? Number.parseInt(parsed.port, 10) : 6379,
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: Number.isFinite(db) ? db : 0,
    tls: parsed.protocol === "rediss:" ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

function loadBullmq(): typeof import("bullmq") {
  if (!bullmqModule) {
    // Lazy-load BullMQ so the in-memory backend doesn't pay BullMQ's startup cost.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    bullmqModule = require("bullmq") as typeof import("bullmq");
  }
  return bullmqModule;
}

function loadRedis(): typeof import("redis") {
  if (!redisModule) {
    // Lazy-load Redis for the same reason; memory mode should not initialize it.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    redisModule = require("redis") as typeof import("redis");
  }
  return redisModule;
}

const SCHEDULED_SYNC_QUEUE_ID = "connector-sync-schedule";

@Injectable()
export class QueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly backend = resolveQueueBackend();
  private readonly workerEnabled = resolveBooleanEnv("QUEUE_WORKER_ENABLED",
    this.backend === "bullmq" ? DEFAULT_QUEUE_WORKER_ENABLED : true);
  private readonly registrations = new Map<string, QueueRegistration>();
  private readonly pending = new Map<string, unknown[]>();
  private readonly bullConnection =
    this.backend === "bullmq"
      ? buildBullConnectionOptions(String(process.env.REDIS_URL ?? DEFAULT_REDIS_URL).trim() || DEFAULT_REDIS_URL)
      : null;
  private readonly metadataRedis: RedisClientType | null =
    this.backend === "bullmq"
      ? loadRedis().createClient({ url: String(process.env.REDIS_URL ?? DEFAULT_REDIS_URL).trim() || DEFAULT_REDIS_URL })
      : null;
  private metadataRedisReady: Promise<void> | null = null;

  private scheduledSyncQueue: BullQueue | null = null;
  private scheduledSyncWorker: Worker | null = null;
  private scheduledSyncHandler: QueueHandler<unknown> | null = null;

  constructor(@Optional() private readonly errorCaptureService?: ErrorCaptureService) {}

  getBackend(): QueueBackend {
    return this.backend;
  }

  isWorkerEnabled(): boolean {
    return this.workerEnabled;
  }

  processScheduledSync(handler: QueueHandler<unknown>): void {
    this.scheduledSyncHandler = handler;
    if (this.backend === "bullmq" && this.workerEnabled && this.bullConnection && !this.scheduledSyncWorker) {
      const { Worker } = loadBullmq();
      this.scheduledSyncWorker = new Worker(
        SCHEDULED_SYNC_QUEUE_ID,
        async (job: BullJob<unknown>) => { await handler(job.data); },
        { connection: this.bullConnection, concurrency: 1 },
      );
      this.scheduledSyncWorker.waitUntilReady().catch(() => undefined);
    }
  }

  async registerRepeatableSync(jobKey: string, payload: unknown, cronPattern: string, active: boolean): Promise<void> {
    if (this.backend !== "bullmq" || !this.bullConnection) {
      return;
    }
    if (!this.scheduledSyncQueue) {
      const { Queue, Worker } = loadBullmq();
      this.scheduledSyncQueue = new Queue(SCHEDULED_SYNC_QUEUE_ID, { connection: this.bullConnection });
      await this.scheduledSyncQueue.waitUntilReady();
      if (this.workerEnabled && !this.scheduledSyncWorker && this.scheduledSyncHandler) {
        const h = this.scheduledSyncHandler;
        this.scheduledSyncWorker = new Worker(
          SCHEDULED_SYNC_QUEUE_ID,
          async (job: BullJob<unknown>) => { await h(job.data); },
          { connection: this.bullConnection, concurrency: 1 },
        );
        await this.scheduledSyncWorker.waitUntilReady().catch(() => undefined);
      }
    }
    const existing = await this.scheduledSyncQueue.getRepeatableJobs();
    for (const job of existing) {
      if (job.name === jobKey) {
        await this.scheduledSyncQueue.removeRepeatableByKey(job.key);
      }
    }
    if (active && cronPattern.trim()) {
      await this.scheduledSyncQueue.add(jobKey, payload, {
        repeat: { pattern: cronPattern },
        removeOnComplete: 50,
        removeOnFail: 50,
      });
    }
  }

  /**
   * CTO review remediation (CODE-002): env-validation.ts already refuses to boot
   * staging/production without QUEUE_BACKEND=bullmq, but that only checks the env
   * var is *set* — it never confirms Redis is actually reachable. Every other
   * BullMQ connection failure in this file is caught and merely logged
   * (`.catch(() => undefined)`), so a misconfigured/unreachable Redis in
   * production previously degraded silently instead of failing the boot.
   * This check runs once at module init and crashes startup in staging/
   * production if Redis can't be reached, matching the fail-fast posture
   * env-validation.ts already established for every other required dependency.
   */
  async onModuleInit(): Promise<void> {
    if (this.backend !== "bullmq") {
      return;
    }
    const appEnv = String(process.env.APP_ENV ?? "development").trim().toLowerCase();
    try {
      await this.ensureMetadataRedis();
    } catch (error: unknown) {
      const message = this.toErrorMessage(error);
      if (appEnv === "staging" || appEnv === "production") {
        throw new Error(
          `QueueService: QUEUE_BACKEND=bullmq but Redis is unreachable at startup (${message}). ` +
            "Refusing to boot in staging/production with a broken queue backend — jobs would silently " +
            "never run. Fix REDIS_URL or Redis connectivity and restart.",
        );
      }
      this.logger.warn(`QueueService: Redis unreachable at startup (${message}). Continuing in ${appEnv} mode.`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    const closeTasks: Array<Promise<void>> = [];
    for (const registration of this.registrations.values()) {
      if (registration.kind !== "bullmq") {
        continue;
      }
      for (const lane of registration.lanes.values()) {
        if (lane.resumeTimer) {
          clearTimeout(lane.resumeTimer);
          lane.resumeTimer = null;
        }
        if (lane.worker) {
          closeTasks.push(lane.worker.close().catch(() => undefined));
        }
        closeTasks.push(lane.queue.close().catch(() => undefined));
      }
    }
    if (this.scheduledSyncWorker) {
      closeTasks.push(this.scheduledSyncWorker.close().catch(() => undefined));
    }
    if (this.scheduledSyncQueue) {
      closeTasks.push(this.scheduledSyncQueue.close().catch(() => undefined));
    }
    if (this.metadataRedis?.isOpen) {
      closeTasks.push(this.metadataRedis.quit().then(() => undefined).catch(() => undefined));
    }
    await Promise.all(closeTasks);
  }

  async enqueue<T>(queueName: QueueName, payload: T, options?: { delayMs?: number; jobId?: string }): Promise<void> {
    const name = String(queueName);
    const delayMs = Math.max(0, Math.floor(Number(options?.delayMs ?? 0)));
    const jobId = options?.jobId ? String(options.jobId).trim() : undefined;
    const registration = this.registrations.get(name);
    if (!registration) {
      const queue = this.pending.get(name) ?? [];
      queue.push(payload);
      this.pending.set(name, queue);
      return;
    }
    if (registration.kind === "memory") {
      this.enqueueToMemoryLane(registration, payload, delayMs);
      return;
    }
    await this.enqueueToBullLane(name, registration, payload, delayMs, jobId);
  }

  process<T>(queueName: QueueName, handler: QueueHandler<T>): void {
    this.register(queueName, handler, {});
  }

  processWithBackpressure<T>(
    queueName: QueueName,
    options: QueueBackpressureOptions<T>,
    handler: QueueHandler<T>,
  ): void {
    this.register(queueName, handler, options);
  }

  async isJobPresent(queueName: QueueName, jobId: string): Promise<boolean> {
    const name = String(queueName);
    const registration = this.registrations.get(name);
    if (!registration) return false;
    if (registration.kind === "memory") {
      // Memory enqueue is synchronous: if we're checking after an enqueue
      // throw, the payload was never pushed — return false (genuinely absent).
      // Memory queue does not use jobId dedup, so we cannot look up by ID;
      // returning false is semantically correct because the enqueue either
      // fully succeeded (no throw, no inspection needed) or fully failed.
      return false;
    }
    for (const [, lane] of registration.lanes) {
      const job = await lane.queue.getJob(jobId);
      if (job) return true;
    }
    return false;
  }

  async getMetrics(): Promise<Record<string, QueueMetrics>> {
    if (this.backend === "bullmq") {
      return this.getBullMetrics();
    }
    return this.getMemoryMetrics();
  }

  private register<T>(
    queueName: QueueName,
    handler: QueueHandler<T>,
    options: QueueBackpressureOptions<T>,
  ): void {
    const name = String(queueName);
    const existing = this.registrations.get(name);
    if (existing) {
      existing.handler = handler as QueueHandler<unknown>;
      existing.options = options as QueueBackpressureOptions<unknown>;
    } else if (this.backend === "bullmq") {
      this.registrations.set(name, {
        kind: "bullmq",
        handler: handler as QueueHandler<unknown>,
        options: options as QueueBackpressureOptions<unknown>,
        lanes: new Map<string, BullLaneState>(),
      });
    } else {
      this.registrations.set(name, {
        kind: "memory",
        handler: handler as QueueHandler<unknown>,
        options: options as QueueBackpressureOptions<unknown>,
        lanes: new Map<string, MemoryLaneState>(),
      });
    }
    const registration = this.registrations.get(name);
    if (!registration) {
      return;
    }

    const queued = this.pending.get(name);
    if (!queued || queued.length === 0) {
      if (registration?.kind === "bullmq" && this.workerEnabled) {
        void this.bootstrapBullLanes(name, registration).catch((error: unknown) => {
          this.logger.error(`Failed to bootstrap BullMQ lanes for ${name}: ${this.toErrorMessage(error)}`);
        });
      }
      return;
    }
    this.pending.delete(name);
    void (async () => {
      for (const payload of queued) {
        await this.enqueue(name, payload);
      }
    })().catch((error: unknown) => {
      this.logger.error(`Failed to flush pending queue registration for ${name}: ${this.toErrorMessage(error)}`);
    });
    if (registration?.kind === "bullmq" && this.workerEnabled) {
      void this.bootstrapBullLanes(name, registration).catch((error: unknown) => {
        this.logger.error(`Failed to bootstrap BullMQ lanes for ${name}: ${this.toErrorMessage(error)}`);
      });
    }
  }

  private getMemoryMetrics(): Record<string, QueueMetrics> {
    const output: Record<string, QueueMetrics> = {};
    for (const [queueName, registration] of this.registrations.entries()) {
      if (registration.kind !== "memory") {
        continue;
      }
      let waiting = 0;
      let active = 0;
      let pausedLanes = 0;
      const lanes: QueueMetrics["lanes"] = {};
      for (const [laneKey, lane] of registration.lanes.entries()) {
        waiting += lane.pending.length;
        active += lane.active;
        const pausedUntil =
          lane.pausedUntilMs && lane.pausedUntilMs > Date.now()
            ? new Date(lane.pausedUntilMs).toISOString()
            : null;
        if (pausedUntil) {
          pausedLanes += 1;
        }
        lanes[laneKey] = {
          waiting: lane.pending.length,
          active: lane.active,
          failed: 0,
          pausedUntil,
        };
      }
      output[queueName] = {
        waiting,
        active,
        failed: 0,
        pausedLanes,
        lanes,
      };
    }
    return output;
  }

  private enqueueToMemoryLane(
    registration: MemoryQueueRegistration,
    payload: unknown,
    delayMs = 0,
  ) {
    const laneKey = this.resolveLaneKey(registration.options, payload);
    const scheduleInsert = () => {
      const lane = this.getOrCreateMemoryLane(registration, laneKey);
      lane.pending.push(payload);
      if (this.workerEnabled) {
        this.scheduleMemoryLaneDrain(registration, laneKey, 0);
      }
    };
    if (delayMs > 0) {
      setTimeout(scheduleInsert, delayMs);
      return;
    }
    scheduleInsert();
  }

  private getOrCreateMemoryLane(registration: MemoryQueueRegistration, laneKey: string): MemoryLaneState {
    const existing = registration.lanes.get(laneKey);
    if (existing) {
      return existing;
    }
    const created: MemoryLaneState = {
      pending: [],
      active: 0,
      scheduled: false,
      pausedUntilMs: null,
      lastStartAtMs: 0,
      consecutiveRateLimitFailures: 0,
      timer: null,
    };
    registration.lanes.set(laneKey, created);
    return created;
  }

  private scheduleMemoryLaneDrain(
    registration: MemoryQueueRegistration,
    laneKey: string,
    delayMs: number,
  ) {
    const lane = this.getOrCreateMemoryLane(registration, laneKey);
    if (lane.scheduled) {
      return;
    }
    lane.scheduled = true;

    const run = () => {
      lane.scheduled = false;
      lane.timer = null;
      this.drainMemoryLane(registration, laneKey);
    };
    if (delayMs > 0) {
      lane.timer = setTimeout(run, delayMs);
      return;
    }
    setImmediate(run);
  }

  private drainMemoryLane(registration: MemoryQueueRegistration, laneKey: string) {
    const lane = this.getOrCreateMemoryLane(registration, laneKey);
    if (lane.pending.length === 0) {
      return;
    }

    const policy = this.resolvePolicy(registration.options, laneKey);
    const now = Date.now();
    if (lane.pausedUntilMs && lane.pausedUntilMs > now) {
      this.scheduleMemoryLaneDrain(registration, laneKey, lane.pausedUntilMs - now);
      return;
    }
    if (lane.active >= policy.concurrency) {
      return;
    }
    if (policy.minIntervalMs > 0 && lane.lastStartAtMs > 0) {
      const elapsed = now - lane.lastStartAtMs;
      if (elapsed < policy.minIntervalMs) {
        this.scheduleMemoryLaneDrain(registration, laneKey, policy.minIntervalMs - elapsed);
        return;
      }
    }

    while (lane.pending.length > 0 && lane.active < policy.concurrency) {
      const currentTime = Date.now();
      if (lane.pausedUntilMs && lane.pausedUntilMs > currentTime) {
        this.scheduleMemoryLaneDrain(registration, laneKey, lane.pausedUntilMs - currentTime);
        return;
      }
      if (policy.minIntervalMs > 0 && lane.lastStartAtMs > 0) {
        const elapsed = currentTime - lane.lastStartAtMs;
        if (elapsed < policy.minIntervalMs) {
          this.scheduleMemoryLaneDrain(registration, laneKey, policy.minIntervalMs - elapsed);
          return;
        }
      }

      const payload = lane.pending.shift();
      if (payload === undefined) {
        return;
      }

      lane.active += 1;
      lane.lastStartAtMs = Date.now();

      setImmediate(async () => {
        try {
          await registration.handler(payload);
          lane.consecutiveRateLimitFailures = 0;
        } catch (error: unknown) {
          this.handleHandlerError(registration, this.resolveQueueName(registration), laneKey, payload, error);
          void this.captureTerminalWorkerFailure(this.resolveQueueName(registration), laneKey, payload, error, {
            jobId: extractSafePayloadRef(payload, "jobId") ?? extractSafePayloadRef(payload, "id"),
          });
          if (this.isRateLimitError(registration.options, error)) {
            lane.consecutiveRateLimitFailures += 1;
            if (lane.consecutiveRateLimitFailures >= policy.rateLimitFailureThreshold) {
              lane.pausedUntilMs = Date.now() + policy.pauseDurationMs;
              lane.consecutiveRateLimitFailures = 0;
              registration.options.onCircuitOpen?.({
                queueName: this.resolveQueueName(registration),
                laneKey,
                pauseUntil: new Date(lane.pausedUntilMs).toISOString(),
              });
            }
          }
        } finally {
          lane.active = Math.max(0, lane.active - 1);
          if (lane.pending.length > 0) {
            this.scheduleMemoryLaneDrain(registration, laneKey, 0);
          }
        }
      });
    }
  }

  private async getBullMetrics(): Promise<Record<string, QueueMetrics>> {
    const output: Record<string, QueueMetrics> = {};
    for (const [queueName, registration] of this.registrations.entries()) {
      if (registration.kind !== "bullmq") {
        continue;
      }
      let waiting = 0;
      let active = 0;
      let pausedLanes = 0;
      const lanes: QueueMetrics["lanes"] = {};
      let failed = 0;
      for (const [laneKey, lane] of registration.lanes.entries()) {
        const counts = await lane.queue.getJobCounts("waiting", "active", "delayed", "prioritized", "failed");
        const laneWaiting =
          Number(counts.waiting ?? 0) + Number(counts.delayed ?? 0) + Number(counts.prioritized ?? 0);
        const laneActive = Number(counts.active ?? 0);
        const laneFailed = Number(counts.failed ?? 0);
        waiting += laneWaiting;
        active += laneActive;
        failed += laneFailed;
        const pausedUntil =
          lane.pausedUntilMs && lane.pausedUntilMs > Date.now()
            ? new Date(lane.pausedUntilMs).toISOString()
            : null;
        if (pausedUntil) {
          pausedLanes += 1;
        }
        lanes[laneKey] = {
          waiting: laneWaiting,
          active: laneActive,
          failed: laneFailed,
          pausedUntil,
        };
      }
      output[queueName] = {
        waiting,
        active,
        failed,
        pausedLanes,
        lanes,
      };
    }
    return output;
  }

  async retryFailedJobs(queueName: string, laneKey: string, limit = 100): Promise<number> {
    const registration = this.registrations.get(queueName);
    if (registration?.kind !== "bullmq") {
      return 0;
    }
    const lane = registration.lanes.get(laneKey);
    if (!lane) {
      return 0;
    }
    const failedJobs = await lane.queue.getFailed(0, limit - 1);
    await Promise.all(failedJobs.map((job: BullJob<unknown>) => job.retry()));
    return failedJobs.length;
  }

  async cleanAllFailedJobs(): Promise<Record<string, number>> {
    const result: Record<string, number> = {};
    for (const [queueName, registration] of this.registrations) {
      if (registration.kind !== "bullmq") continue;
      let total = 0;
      for (const [, lane] of registration.lanes) {
        const removed = await lane.queue.clean(0, 1000, "failed");
        total += removed.length;
      }
      if (total > 0) result[queueName] = total;
    }
    return result;
  }

  async listFailedJobs(queueName: string, laneKey: string, limit = 20): Promise<QueueFailedJobSummary[]> {
    const registration = this.registrations.get(queueName);
    if (registration?.kind !== "bullmq") {
      return [];
    }
    const lane = registration.lanes.get(laneKey);
    if (!lane) {
      return [];
    }
    const resolvedLimit = Math.max(1, Math.min(100, Number.isFinite(limit) ? Math.trunc(limit) : 20));
    const failedJobs = await lane.queue.getFailed(0, resolvedLimit - 1);
    return failedJobs.map((job: BullJob<unknown>): QueueFailedJobSummary => ({
      id: String(job.id ?? ""),
      name: String(job.name ?? ""),
      failedReason: this.truncateDiagnostic(job.failedReason),
      attemptsMade: Number(job.attemptsMade ?? 0),
      timestamp: this.toIsoTimestamp(job.timestamp),
      processedOn: this.toIsoTimestamp(job.processedOn),
      finishedOn: this.toIsoTimestamp(job.finishedOn),
    }));
  }

  private async enqueueToBullLane(
    queueName: string,
    registration: BullQueueRegistration,
    payload: unknown,
    delayMs = 0,
    jobId?: string,
  ): Promise<void> {
    const laneKey = this.resolveLaneKey(registration.options, payload);
    await this.rememberBullLane(queueName, laneKey);
    const lane = await this.getOrCreateBullLane(queueName, registration, laneKey);
    await lane.queue.add(`${queueName}:${laneKey}`, payload, {
      ...(jobId ? { jobId } : {}),
      attempts: 3,
      backoff: {
        type: "exponential",
        delay: 2_000,
      },
      delay: delayMs,
      removeOnComplete: 1000,
      removeOnFail: 1000,
    });
  }

  private async getOrCreateBullLane(
    queueName: string,
    registration: BullQueueRegistration,
    laneKey: string,
  ): Promise<BullLaneState> {
    const existing = registration.lanes.get(laneKey);
    if (existing) {
      return existing;
    }
    if (!this.bullConnection) {
      throw new Error("BullMQ queue backend selected without Redis connection options.");
    }
    const policy = this.resolvePolicy(registration.options, laneKey);
    const queueId = this.buildBullQueueId(queueName, laneKey);
    const { Queue, Worker } = loadBullmq();
    const queue = new Queue(queueId, {
      connection: this.bullConnection,
      defaultJobOptions: {
        removeOnComplete: 1000,
        removeOnFail: 1000,
      },
    });
    await queue.waitUntilReady();

    const created: BullLaneState = {
      queue,
      worker: null,
      active: 0,
      pausedUntilMs: null,
      consecutiveRateLimitFailures: 0,
      resumeTimer: null,
      waiting: 0,
    };
    registration.lanes.set(laneKey, created);

    if (this.workerEnabled) {
      created.worker = new Worker(
        queueId,
        async (job: BullJob<unknown>) => {
          created.active += 1;
          try {
            await registration.handler(job.data);
            created.consecutiveRateLimitFailures = 0;
          } catch (error: unknown) {
            this.handleHandlerError(registration, queueName, laneKey, job.data, error);
            if (this.isRateLimitError(registration.options, error)) {
              created.consecutiveRateLimitFailures += 1;
              if (created.consecutiveRateLimitFailures >= policy.rateLimitFailureThreshold) {
                await this.pauseBullLane(queueName, laneKey, registration, created, policy);
                created.consecutiveRateLimitFailures = 0;
              }
            }
            throw error;
          } finally {
            created.active = Math.max(0, created.active - 1);
          }
        },
        {
          connection: this.bullConnection,
          concurrency: policy.concurrency,
          ...(policy.minIntervalMs > 0
            ? {
                limiter: {
                  max: Math.max(1, policy.concurrency),
                  duration: policy.minIntervalMs,
                },
              }
            : {}),
        },
      );
      created.worker.on("failed", (job: BullJob<unknown> | undefined, error: Error) => {
        if (!job || !isTerminalBullFailure(job.attemptsMade, job.opts?.attempts)) {
          return;
        }
        void this.captureTerminalWorkerFailure(queueName, laneKey, job.data, error, {
          jobId: String(job.id ?? ""),
          sourceEventId: `bullmq:${queueName}:${laneKey}:${String(job.id ?? "")}:terminal`,
        });
      });
      await created.worker.waitUntilReady();
    }

    return created;
  }

  private async bootstrapBullLanes(queueName: string, registration: BullQueueRegistration): Promise<void> {
    const redis = await this.ensureMetadataRedis();
    if (!redis) {
      return;
    }
    const laneKeys = await redis.sMembers(this.buildBullLaneRegistryKey(queueName));
    for (const laneKey of laneKeys) {
      await this.getOrCreateBullLane(queueName, registration, laneKey);
    }
  }

  private async rememberBullLane(queueName: string, laneKey: string): Promise<void> {
    const redis = await this.ensureMetadataRedis();
    if (!redis) {
      return;
    }
    await redis.sAdd(this.buildBullLaneRegistryKey(queueName), laneKey);
  }

  private async pauseBullLane(
    queueName: string,
    laneKey: string,
    registration: BullQueueRegistration,
    lane: BullLaneState,
    policy: QueueLanePolicy,
  ): Promise<void> {
    if (!lane.worker || policy.pauseDurationMs <= 0) {
      return;
    }
    if (lane.resumeTimer) {
      clearTimeout(lane.resumeTimer);
      lane.resumeTimer = null;
    }
    lane.pausedUntilMs = Date.now() + policy.pauseDurationMs;
    await lane.worker.pause();
    registration.options.onCircuitOpen?.({
      queueName,
      laneKey,
      pauseUntil: new Date(lane.pausedUntilMs).toISOString(),
    });
    lane.resumeTimer = setTimeout(() => {
      lane.pausedUntilMs = null;
      lane.resumeTimer = null;
      if (!lane.worker) {
        return;
      }
      try {
        lane.worker.resume();
      } catch (error: unknown) {
        this.logger.error(`Failed to resume BullMQ worker for ${queueName}/${laneKey}: ${this.toErrorMessage(error)}`);
      }
    }, policy.pauseDurationMs);
  }

  private resolveLaneKey(options: QueueBackpressureOptions<unknown>, payload: unknown): string {
    const resolver = options.laneResolver as ((item: unknown) => string) | undefined;
    if (!resolver) {
      return "default";
    }
    const resolved = String(resolver(payload) ?? "").trim();
    return resolved || "default";
  }

  private resolvePolicy(
    options: QueueBackpressureOptions<unknown>,
    laneKey: string,
  ): QueueLanePolicy {
    const merged = {
      ...DEFAULT_POLICY,
      ...(options.defaultLanePolicy ?? {}),
      ...(options.lanePolicies?.[laneKey] ?? {}),
    };
    const concurrency = Math.max(1, Math.floor(Number(merged.concurrency)));
    const minIntervalMs = Math.max(0, Math.floor(Number(merged.minIntervalMs)));
    const rateLimitFailureThreshold = Math.max(
      1,
      Math.floor(Number(merged.rateLimitFailureThreshold)),
    );
    const pauseDurationMs = Math.max(0, Math.floor(Number(merged.pauseDurationMs)));
    return {
      concurrency,
      minIntervalMs,
      rateLimitFailureThreshold,
      pauseDurationMs,
    };
  }

  private handleHandlerError(
    registration: QueueRegistration,
    queueName: string,
    laneKey: string,
    payload: unknown,
    error: unknown,
  ) {
    const errorMessage = this.toErrorMessage(error);
    this.logger.error(`Queue handler error for ${queueName}/${laneKey}: ${errorMessage}`);
    registration.options.onHandlerError?.({
      queueName,
      laneKey,
      payload,
      errorMessage,
    });
  }

  private async captureTerminalWorkerFailure(
    queueName: string,
    laneKey: string,
    payload: unknown,
    error: unknown,
    context: { jobId?: string; sourceEventId?: string } = {},
  ): Promise<void> {
    if (!this.errorCaptureService) {
      return;
    }
    const classification = classifyWorkerError(error);
    if (!classification.capture) {
      return;
    }
    await this.errorCaptureService.captureUnexpected({
      runtime: "worker",
      service: "vexa-pim-api",
      error,
      errorCode: classification.reason,
      category: classification.category,
      severity: "p1",
      routeTemplate: `queue:${queueName}:${laneKey}`,
      rawTenantKey: extractSafePayloadRef(payload, "tenantKey") || extractSafePayloadRef(payload, "tenantId"),
      jobId: context.jobId || extractSafePayloadRef(payload, "jobId") || extractSafePayloadRef(payload, "id"),
      operationId: extractSafePayloadRef(payload, "operationId") || extractSafePayloadRef(payload, "runId"),
      installationId: extractSafePayloadRef(payload, "installationId"),
      sourceEventId: context.sourceEventId,
    });
  }

  private isRateLimitError(options: QueueBackpressureOptions<unknown>, error: unknown): boolean {
    if (options.isRateLimitError?.(error)) {
      return true;
    }
    if (error instanceof QueueRateLimitError) {
      return true;
    }
    const message = error instanceof Error ? error.message.toLowerCase() : "";
    if (!message) {
      return false;
    }
    return message.includes("429") || message.includes("rate limit");
  }

  private toErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim().length > 0) {
      return error.message.trim();
    }
    return String(error ?? "Unknown queue handler error");
  }

  private truncateDiagnostic(value: unknown): string | null {
    const text = String(value ?? "").trim();
    return text ? text.slice(0, 1000) : null;
  }

  private toIsoTimestamp(value: unknown): string | null {
    const timestamp = Number(value ?? 0);
    if (!Number.isFinite(timestamp) || timestamp <= 0) {
      return null;
    }
    return new Date(timestamp).toISOString();
  }

  private resolveQueueName(registration: QueueRegistration): string {
    for (const [queueName, value] of this.registrations.entries()) {
      if (value === registration) {
        return queueName;
      }
    }
    return "unknown";
  }

  private buildBullQueueId(queueName: string, laneKey: string): string {
    return `pim1--${queueName}--${encodeURIComponent(laneKey)}`;
  }

  private buildBullLaneRegistryKey(queueName: string): string {
    return `pim1--lane-registry--${queueName}`;
  }

  private async ensureMetadataRedis(): Promise<RedisClientType | null> {
    if (!this.metadataRedis) {
      return null;
    }
    if (!this.metadataRedisReady) {
      this.metadataRedisReady = this.metadataRedis.connect().then(() => undefined);
    }
    await this.metadataRedisReady;
    return this.metadataRedis;
  }
}
