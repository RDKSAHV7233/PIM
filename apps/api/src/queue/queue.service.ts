import { Injectable, Logger } from "@nestjs/common";
import { QueueName } from "./queue.constants";

type QueueHandler<T = unknown> = (payload: T) => Promise<void> | void;

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

type QueueRegistration = {
  handler: QueueHandler<unknown>;
  options: QueueBackpressureOptions<unknown>;
  lanes: Map<string, LaneState>;
};

type LaneState = {
  pending: unknown[];
  active: number;
  scheduled: boolean;
  pausedUntilMs: number | null;
  lastStartAtMs: number;
  consecutiveRateLimitFailures: number;
  timer: NodeJS.Timeout | null;
};

const DEFAULT_POLICY: QueueLanePolicy = {
  concurrency: Number.MAX_SAFE_INTEGER,
  minIntervalMs: 0,
  rateLimitFailureThreshold: Number.MAX_SAFE_INTEGER,
  pauseDurationMs: 0,
};

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);
  private readonly registrations = new Map<string, QueueRegistration>();
  private readonly pending = new Map<string, unknown[]>();

  enqueue<T>(queueName: QueueName, payload: T): void {
    const name = String(queueName);
    const registration = this.registrations.get(name);
    if (!registration) {
      const queue = this.pending.get(name) ?? [];
      queue.push(payload);
      this.pending.set(name, queue);
      return;
    }
    this.enqueueToLane(registration, payload);
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

  getMetrics(): Record<string, QueueMetrics> {
    const output: Record<string, QueueMetrics> = {};
    for (const [queueName, registration] of this.registrations.entries()) {
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
    } else {
      this.registrations.set(name, {
        handler: handler as QueueHandler<unknown>,
        options: options as QueueBackpressureOptions<unknown>,
        lanes: new Map<string, LaneState>(),
      });
    }

    const queued = this.pending.get(name);
    if (!queued || queued.length === 0) {
      return;
    }
    this.pending.delete(name);
    for (const payload of queued) {
      this.enqueue(name, payload);
    }
  }

  private enqueueToLane(registration: QueueRegistration, payload: unknown) {
    const laneKey = this.resolveLaneKey(registration.options, payload);
    const lane = this.getOrCreateLane(registration, laneKey);
    lane.pending.push(payload);
    this.scheduleLaneDrain(registration, laneKey, 0);
  }

  private resolveLaneKey(options: QueueBackpressureOptions<unknown>, payload: unknown): string {
    const resolver = options.laneResolver as ((item: unknown) => string) | undefined;
    if (!resolver) {
      return "default";
    }
    const resolved = String(resolver(payload) ?? "").trim();
    return resolved || "default";
  }

  private getOrCreateLane(registration: QueueRegistration, laneKey: string): LaneState {
    const existing = registration.lanes.get(laneKey);
    if (existing) {
      return existing;
    }
    const created: LaneState = {
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

  private scheduleLaneDrain(
    registration: QueueRegistration,
    laneKey: string,
    delayMs: number,
  ) {
    const lane = this.getOrCreateLane(registration, laneKey);
    if (lane.scheduled) {
      return;
    }
    lane.scheduled = true;

    const run = () => {
      lane.scheduled = false;
      lane.timer = null;
      this.drainLane(registration, laneKey);
    };
    if (delayMs > 0) {
      lane.timer = setTimeout(run, delayMs);
      return;
    }
    setImmediate(run);
  }

  private drainLane(registration: QueueRegistration, laneKey: string) {
    const lane = this.getOrCreateLane(registration, laneKey);
    if (lane.pending.length === 0) {
      return;
    }

    const policy = this.resolvePolicy(registration.options, laneKey);
    const now = Date.now();
    if (lane.pausedUntilMs && lane.pausedUntilMs > now) {
      this.scheduleLaneDrain(registration, laneKey, lane.pausedUntilMs - now);
      return;
    }
    if (lane.active >= policy.concurrency) {
      return;
    }
    if (policy.minIntervalMs > 0 && lane.lastStartAtMs > 0) {
      const elapsed = now - lane.lastStartAtMs;
      if (elapsed < policy.minIntervalMs) {
        this.scheduleLaneDrain(registration, laneKey, policy.minIntervalMs - elapsed);
        return;
      }
    }

    while (lane.pending.length > 0 && lane.active < policy.concurrency) {
      const currentTime = Date.now();
      if (lane.pausedUntilMs && lane.pausedUntilMs > currentTime) {
        this.scheduleLaneDrain(registration, laneKey, lane.pausedUntilMs - currentTime);
        return;
      }
      if (policy.minIntervalMs > 0 && lane.lastStartAtMs > 0) {
        const elapsed = currentTime - lane.lastStartAtMs;
        if (elapsed < policy.minIntervalMs) {
          this.scheduleLaneDrain(registration, laneKey, policy.minIntervalMs - elapsed);
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
          const queueName = this.resolveQueueName(registration);
          const errorMessage = this.toErrorMessage(error);
          this.logger.error(`Queue handler error for ${queueName}/${laneKey}: ${errorMessage}`);
          registration.options.onHandlerError?.({
            queueName,
            laneKey,
            payload,
            errorMessage,
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
            this.scheduleLaneDrain(registration, laneKey, 0);
          }
        }
      });
    }
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

}
