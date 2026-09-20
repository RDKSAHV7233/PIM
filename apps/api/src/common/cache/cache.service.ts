import { Injectable, Logger, OnModuleDestroy } from "@nestjs/common";
import { createClient } from "redis";

/**
 * Shared cache service — Redis + in-memory fallback.
 *
 * Design goals:
 *  - Non-fatal: any Redis error falls back to a local TTL Map; never throws.
 *  - Generic: works with any JSON-serializable type (not tied to a closed union).
 *  - Safe retry: after a Redis error, waits REDIS_RETRY_BACKOFF_MS before retrying.
 *  - Prefix invalidation: uses Redis SCAN + DEL for pattern-based cache busting.
 *
 * Registered globally via CacheModule so all feature modules can inject it
 * without explicitly importing CacheModule.
 */

const REDIS_RETRY_BACKOFF_MS = 30_000;
// A live TCP connection with a stalled/unresponsive Redis server (a "zombie"
// connection — the socket never errors or closes, it just never answers) isn't
// caught by connectTimeout, which only bounds the initial connect(). Every
// command below is wrapped in this same class of fix already applied to
// quit() at shutdown (see onModuleDestroy()'s own comment, PIM#817-outage-proof)
// so a zombie connection degrades every request to REDIS_COMMAND_TIMEOUT_MS
// instead of hanging it forever.
const REDIS_COMMAND_TIMEOUT_MS = 2_000;

type FallbackEntry = { value: unknown; expiresAt: number };

export type RedisHealthSnapshot =
  | {
      available: true;
      usedMemory: number | null;
      maxMemory: number | null;
      maxMemoryPolicy: string | null;
      blockedClients: number | null;
      connectedClients: number | null;
    }
  | { available: false };

@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);

  private readonly redisDisabled =
    String(process.env.CACHE_REDIS_DISABLED ?? "").trim().toLowerCase() === "true";
  private readonly redisUrl = String(process.env.REDIS_URL ?? "redis://localhost:6379").trim();

  private redisClient: ReturnType<typeof createClient> | null = null;
  private redisConnecting: Promise<void> | null = null;
  private redisAvailable = false;
  private redisRetryAfterMs = 0;

  /** In-memory fallback — active when Redis is unavailable. */
  private readonly fallback = new Map<string, FallbackEntry>();

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Return the cached value for `key` if still fresh; otherwise call `producer`,
   * store the result with the given TTL, and return it.
   *
   * Errors from Redis are silenced — the cache acts as a best-effort layer.
   */
  async getOrSet<T>(key: string, ttlSeconds: number, producer: () => Promise<T>): Promise<T> {
    const cached = await this.read<T>(key, ttlSeconds);
    if (cached !== null) {
      return cached;
    }
    const value = await producer();
    await this.write(key, value, ttlSeconds);
    return value;
  }

  /**
   * Evict a single cache key from Redis and the in-memory fallback.
   */
  async invalidate(key: string): Promise<void> {
    this.fallback.delete(key);
    if (!(await this.ensureRedisAvailable()) || !this.redisClient) {
      return;
    }
    try {
      await this.withCommandTimeout(this.redisClient.del(key));
    } catch (err) {
      this.markRedisUnavailable(err);
    }
  }

  /**
   * Evict all keys whose name starts with `prefix + ":"`.
   * Uses Redis SCAN to avoid blocking; sweeps the in-memory fallback inline.
   */
  async invalidateByPrefix(prefix: string): Promise<void> {
    const pattern = `${prefix}:*`;

    // In-memory sweep
    for (const key of this.fallback.keys()) {
      if (key.startsWith(`${prefix}:`)) {
        this.fallback.delete(key);
      }
    }

    if (!(await this.ensureRedisAvailable()) || !this.redisClient) {
      return;
    }
    try {
      const client = this.redisClient;
      await this.withCommandTimeout(
        (async () => {
          const keysToDelete: string[] = [];
          for await (const keys of client.scanIterator({ MATCH: pattern, COUNT: 100 })) {
            keysToDelete.push(...keys);
          }
          if (keysToDelete.length > 0) {
            await client.del(keysToDelete);
          }
        })(),
        REDIS_COMMAND_TIMEOUT_MS * 5, // multiple round trips (SCAN cursor + DEL), not a single command
      );
    } catch (err) {
      this.markRedisUnavailable(err);
    }
  }

  /**
   * Return a small, allowlisted Redis health snapshot for internal operators.
   * This deliberately avoids exposing raw INFO output, Redis URL, version, or config.
   */
  async getHealthSnapshot(): Promise<RedisHealthSnapshot> {
    if (!(await this.ensureRedisAvailable()) || !this.redisClient) {
      return { available: false };
    }

    try {
      const info = await this.withCommandTimeout(this.redisClient.info());
      return parseRedisHealthInfo(info);
    } catch (err) {
      this.markRedisUnavailable(err);
      return { available: false };
    }
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  async onModuleDestroy(): Promise<void> {
    if (this.redisClient) {
      // A half-open socket at shutdown never gets a QUIT response, so quit()
      // can hang indefinitely and block process exit. Bound the wait instead
      // — mirrors auth.service.ts's onModuleDestroy() (see PIM#817-outage-proof
      // and its jwt-blocklist.service.ts follow-up for the same finding).
      await Promise.race([
        this.redisClient.quit().catch(() => undefined),
        new Promise<void>((resolve) => {
          setTimeout(resolve, 300);
        }),
      ]);
      this.redisClient = null;
    }
    this.redisAvailable = false;
    this.fallback.clear();
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private readFallback<T>(key: string, ttlSeconds: number): T | null {
    const entry = this.fallback.get(key);
    if (!entry) return null;
    if (Date.now() >= entry.expiresAt) {
      this.fallback.delete(key);
      return null;
    }
    // Reject stale entries whose remaining TTL has collapsed below 0
    const remaining = entry.expiresAt - Date.now();
    if (remaining <= 0 || remaining > ttlSeconds * 1000 * 2) {
      // paranoia: discard entries that look wrong
      this.fallback.delete(key);
      return null;
    }
    return entry.value as T;
  }

  private writeFallback(key: string, value: unknown, ttlSeconds: number): void {
    this.fallback.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  private async read<T>(key: string, ttlSeconds: number): Promise<T | null> {
    // Try in-memory first (warm path, zero network round-trip)
    const local = this.readFallback<T>(key, ttlSeconds);
    if (local !== null) return local;

    if (!(await this.ensureRedisAvailable()) || !this.redisClient) {
      return null;
    }
    try {
      const raw = await this.withCommandTimeout(this.redisClient.get(key));
      if (!raw) return null;
      const parsed = JSON.parse(String(raw)) as T;
      // Warm the in-memory fallback so the next call within the same process is free
      this.writeFallback(key, parsed, ttlSeconds);
      return parsed;
    } catch (err) {
      this.markRedisUnavailable(err);
      return null;
    }
  }

  private async write(key: string, value: unknown, ttlSeconds: number): Promise<void> {
    this.writeFallback(key, value, ttlSeconds);
    if (!(await this.ensureRedisAvailable()) || !this.redisClient) {
      return;
    }
    try {
      await this.withCommandTimeout(this.redisClient.setEx(key, ttlSeconds, JSON.stringify(value)));
    } catch (err) {
      this.markRedisUnavailable(err);
    }
  }

  private async ensureRedisAvailable(): Promise<boolean> {
    if (this.redisDisabled) return false;
    if (this.redisAvailable) return true;
    if (Date.now() < this.redisRetryAfterMs) return false;

    if (this.redisConnecting) {
      await this.redisConnecting;
      return this.redisAvailable;
    }

    this.redisConnecting = (async () => {
      try {
        const client = createClient({
          url: this.redisUrl,
          socket: {
            connectTimeout: 2_000,
            reconnectStrategy: () => false,
          },
        });
        client.on("error", (err: unknown) => {
          this.markRedisUnavailable(err);
        });
        await client.connect();
        this.redisClient = client;
        this.redisAvailable = true;
        this.redisRetryAfterMs = 0;
      } catch (err) {
        this.markRedisUnavailable(err);
      } finally {
        this.redisConnecting = null;
      }
    })();

    await this.redisConnecting;
    return this.redisAvailable;
  }

  /**
   * Bound a single Redis command so a zombie connection (alive socket, no
   * response) degrades to "unavailable" after REDIS_COMMAND_TIMEOUT_MS
   * instead of hanging the caller forever. Rejects on timeout so every call
   * site's existing try/catch → markRedisUnavailable() path handles it the
   * same way as any other Redis error.
   */
  private withCommandTimeout<T>(command: Promise<T>, timeoutMs = REDIS_COMMAND_TIMEOUT_MS): Promise<T> {
    // If the timeout wins the race, `command` keeps running in the background
    // (Promise.race can't cancel it) and may reject later — e.g. the zombie
    // connection finally errors out. Without this, that's an unhandled
    // rejection. Same diligence as onModuleDestroy()'s quit().catch(() => undefined).
    command.catch(() => undefined);
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Redis command timed out after ${timeoutMs}ms`)),
        timeoutMs,
      );
    });
    return Promise.race([command, timeout]).finally(() => clearTimeout(timer));
  }

  private markRedisUnavailable(err?: unknown): void {
    this.redisAvailable = false;
    this.redisRetryAfterMs = Date.now() + REDIS_RETRY_BACKOFF_MS;
    if (err) {
      this.logger.warn(`Redis unavailable, falling back to in-memory cache: ${String(err)}`);
    }
  }
}

export function parseRedisHealthInfo(info: string): RedisHealthSnapshot {
  const fields = new Map<string, string>();
  for (const line of info.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf(":");
    if (separatorIndex <= 0) {
      continue;
    }
    fields.set(trimmed.slice(0, separatorIndex), trimmed.slice(separatorIndex + 1));
  }

  return {
    available: true,
    usedMemory: parseRedisInteger(fields.get("used_memory")),
    maxMemory: parseRedisInteger(fields.get("maxmemory")),
    maxMemoryPolicy: normalizeRedisText(fields.get("maxmemory_policy")),
    blockedClients: parseRedisInteger(fields.get("blocked_clients")),
    connectedClients: parseRedisInteger(fields.get("connected_clients")),
  };
}

function parseRedisInteger(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeRedisText(value: string | undefined): string | null {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : null;
}
