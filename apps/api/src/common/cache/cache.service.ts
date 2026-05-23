import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { createClient } from "redis";

const DEFAULT_TTL_SECONDS = 5 * 60;
const REDIS_RETRY_BACKOFF_MS = 30_000;
const FALLBACK_SWEEP_INTERVAL_MS = 60_000;
const FALLBACK_MAX_ENTRIES = 2_000;

@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly redisDisabled =
    String(process.env.CACHE_REDIS_DISABLED ?? "").trim().toLowerCase() === "true";
  private readonly redisUrl = String(process.env.REDIS_URL ?? "redis://localhost:6379").trim();
  private redisClient: ReturnType<typeof createClient> | null = null;
  private redisConnecting: Promise<void> | null = null;
  private redisAvailable = false;
  private redisRetryAfterMs = 0;
  private readonly fallbackCache = new Map<string, { value: unknown; expiresAt: number }>();
  private sweepTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.sweepTimer = setInterval(() => this.sweepFallbackCache(), FALLBACK_SWEEP_INTERVAL_MS);
    // Allow the process/test worker to exit even if the timer is still pending.
    (this.sweepTimer as NodeJS.Timeout).unref();
  }

  async get<T>(key: string, ttlSeconds = DEFAULT_TTL_SECONDS): Promise<T | null> {
    return this.read<T>(key, ttlSeconds);
  }

  async set<T>(key: string, value: T, ttlSeconds = DEFAULT_TTL_SECONDS): Promise<void> {
    return this.write(key, value, ttlSeconds);
  }

  async getOrSet<T>(
    key: string,
    producer: () => Promise<T>,
    ttlSeconds = DEFAULT_TTL_SECONDS,
  ): Promise<T> {
    const cached = await this.read<T>(key, ttlSeconds);
    if (cached !== null) {
      return cached;
    }
    const value = await producer();
    await this.write(key, value, ttlSeconds);
    return value;
  }

  async invalidate(key: string): Promise<void> {
    this.fallbackCache.delete(key);
    if (!(await this.ensureRedisAvailable()) || !this.redisClient) {
      return;
    }
    try {
      await this.redisClient.del(key);
    } catch {
      this.markRedisUnavailable();
    }
  }

  async invalidatePattern(prefix: string): Promise<void> {
    for (const key of this.fallbackCache.keys()) {
      if (key.startsWith(prefix)) {
        this.fallbackCache.delete(key);
      }
    }
    if (!(await this.ensureRedisAvailable()) || !this.redisClient) {
      return;
    }
    try {
      // Use SCAN instead of KEYS to avoid blocking the Redis event loop on large keyspaces.
      const pattern = `${prefix}*`;
      let cursor: string = "0";
      do {
        const result = await this.redisClient.scan(cursor, { MATCH: pattern, COUNT: 100 });
        cursor = result.cursor;
        if (result.keys.length > 0) {
          await this.redisClient.del(result.keys);
        }
      } while (cursor !== "0");
    } catch {
      this.markRedisUnavailable();
    }
  }

  private async read<T>(key: string, ttlSeconds: number): Promise<T | null> {
    const fallback = this.readFallback<T>(key);
    if (fallback !== null) {
      return fallback;
    }
    if (!(await this.ensureRedisAvailable()) || !this.redisClient) {
      return null;
    }
    try {
      const raw = await this.redisClient.get(key);
      if (!raw) {
        return null;
      }
      const parsed = JSON.parse(String(raw)) as T;
      this.writeFallback(key, parsed, ttlSeconds);
      return parsed;
    } catch {
      this.markRedisUnavailable();
      return null;
    }
  }

  private async write<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.writeFallback(key, value, ttlSeconds);
    if (!(await this.ensureRedisAvailable()) || !this.redisClient) {
      return;
    }
    try {
      await this.redisClient.setEx(key, ttlSeconds, JSON.stringify(value));
    } catch {
      this.markRedisUnavailable();
    }
  }

  private readFallback<T>(key: string): T | null {
    const cached = this.fallbackCache.get(key);
    if (!cached) {
      return null;
    }
    if (Date.now() >= cached.expiresAt) {
      this.fallbackCache.delete(key);
      return null;
    }
    return cached.value as T;
  }

  private writeFallback(key: string, value: unknown, ttlSeconds: number): void {
    if (this.fallbackCache.size >= FALLBACK_MAX_ENTRIES && !this.fallbackCache.has(key)) {
      // Evict the oldest entry (Map preserves insertion order).
      const firstKey = this.fallbackCache.keys().next().value;
      if (firstKey !== undefined) {
        this.fallbackCache.delete(firstKey);
      }
    }
    this.fallbackCache.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  private sweepFallbackCache(): void {
    const now = Date.now();
    for (const [key, entry] of this.fallbackCache) {
      if (now >= entry.expiresAt) {
        this.fallbackCache.delete(key);
      }
    }
  }

  private async ensureRedisAvailable(): Promise<boolean> {
    if (this.redisDisabled) {
      return false;
    }
    if (this.redisAvailable) {
      return true;
    }
    if (Date.now() < this.redisRetryAfterMs) {
      return false;
    }
    if (this.redisConnecting) {
      await this.redisConnecting;
      return this.redisAvailable;
    }
    this.redisConnecting = (async () => {
      try {
        const client = createClient({
          url: this.redisUrl,
          socket: { connectTimeout: 2_000, reconnectStrategy: () => false },
        });
        client.on("error", () => this.markRedisUnavailable());
        await client.connect();
        this.redisClient = client;
        this.redisAvailable = true;
        this.redisRetryAfterMs = 0;
      } catch {
        this.markRedisUnavailable();
      } finally {
        this.redisConnecting = null;
      }
    })();
    await this.redisConnecting;
    return this.redisAvailable;
  }

  private markRedisUnavailable(): void {
    this.redisAvailable = false;
    this.redisRetryAfterMs = Date.now() + REDIS_RETRY_BACKOFF_MS;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    if (this.redisClient) {
      await this.redisClient.quit().catch(() => undefined);
      this.redisClient = null;
    }
  }
}
