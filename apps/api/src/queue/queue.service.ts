import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { Job, Queue as BullQueue, Worker } from "bullmq";
import { RedisClientType, createClient } from "redis";
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
  pausedLanes: number;
  lanes: Record<
    string,
    {
      waiting: number;
      active: number;
      pausedUntil: string | null;
    }
  >;
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

@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  private readonly backend = resolveQueueBackend();
  private readonly workerEnabled =
    this.backend === "bullmq" ? resolveBooleanEnv("QUEUE_WORKER_ENABLED", DEFAULT_QUEUE_WORKER_ENABLED) : true;
  private readonly registrations = new Map<string, QueueRegistration>();
  private readonly pending = new Map<string, unknown[]>();
  private readonly bullConnection =
    this.backend === "bullmq"
      ? buildBullConnectionOptions(String(process.env.REDIS_URL ?? DEFAULT_REDIS_URL).trim() || DEFAULT_REDIS_URL)
      : null;
  private readonly metadataRedis: RedisClientType | null =
    this.backend === "bullmq"
      ? createClient({ url: String(process.env.REDIS_URL ?? DEFAULT_REDIS_URL).trim() || DEFAULT_REDIS_URL })
      : null;
  private metadataRedisReady: Promise<void> | null = null;

  getBackend(): QueueBackend {
    return this.backend;
  }

  isWorkerEnabled(): boolean {
    return this.workerEnabled;
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
    if (this.metadataRedis?.isOpen) {
      closeTasks.push(this.metadataRedis.quit().then(() => undefined).catch(() => undefined));
    }
    await Promise.all(closeTasks);
  }

  async enqueue<T>(queueName: QueueName, payload: T, options?: { delayMs?: number }): Promise<void> {
    const name = String(queueName);
    const delayMs = Math.max(0, Math.floor(Number(options?.delayMs ?? 0)));
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
    await this.enqueueToBullLane(name, registration, payload, delayMs);
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
          pausedUntil,
        };
      }
      output[queueName] = {
        waiting,
        active,
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
      this.scheduleMemoryLaneDrain(registration, laneKey, 0);
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
      for (const [laneKey, lane] of registration.lanes.entries()) {
        const counts = await lane.queue.getJobCounts("waiting", "active", "delayed", "prioritized");
        const laneWaiting =
          Number(counts.waiting ?? 0) + Number(counts.delayed ?? 0) + Number(counts.prioritized ?? 0);
        const laneActive = Number(counts.active ?? 0);
        waiting += laneWaiting;
        active += laneActive;
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
          pausedUntil,
        };
      }
      output[queueName] = {
        waiting,
        active,
        pausedLanes,
        lanes,
      };
    }
    return output;
  }

  private async enqueueToBullLane(
    queueName: string,
    registration: BullQueueRegistration,
    payload: unknown,
    delayMs = 0,
  ): Promise<void> {
    const laneKey = this.resolveLaneKey(registration.options, payload);
    await this.rememberBullLane(queueName, laneKey);
    const lane = await this.getOrCreateBullLane(queueName, registration, laneKey);
    await lane.queue.add(`${queueName}:${laneKey}`, payload, {
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
    const queue = new BullQueue(queueId, {
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
        async (job: Job<unknown>) => {
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
