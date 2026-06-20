import { Injectable, Logger, OnModuleDestroy, UnauthorizedException } from "@nestjs/common";
import { createClient } from "redis";

const DEFAULT_REDIS_URL = "redis://localhost:6379";
const DEFAULT_PREFIX = "jti:";
const CACHE_TTL_MS = 10_000;
const CACHE_MAX_SIZE = 500;
const REDIS_RETRY_BACKOFF_MS = 30_000;
const REDIS_WARN_THROTTLE_MS = 10_000;
const REDIS_CONNECT_TIMEOUT_MS = 1_000;
// Must exceed the longest-lived token type (refresh = 7 days).
const CRED_REV_TTL_SECONDS = 7 * 24 * 60 * 60;
const CRED_REV_CACHE_TTL_MS = 30_000;

interface CacheEntry {
  value: boolean;
  expiresAtMs: number;
}

@Injectable()
export class JwtBlocklistService implements OnModuleDestroy {
  private readonly logger = new Logger(JwtBlocklistService.name);
  private readonly memoryBlocklist = new Map<string, number>();
  private readonly cache = new Map<string, CacheEntry>();
  private readonly credRevCache = new Map<string, { epoch: number; expiresAtMs: number }>();
  private redisClient: ReturnType<typeof createClient> | null = null;
  private redisConnecting: Promise<void> | null = null;
  private redisAvailable = false;
  private redisRetryAfterMs = 0;
  private lastRedisWarnAtMs = 0;

  private get keyPrefix(): string {
    const value = String(process.env.JWT_BLOCKLIST_KEY_PREFIX ?? "").trim();
    return value.length > 0 ? value : DEFAULT_PREFIX;
  }

  private isRedisDisabled(): boolean {
    return String(process.env.JWT_BLOCKLIST_REDIS_DISABLED ?? "false")
      .trim()
      .toLowerCase() === "true";
  }

  private keyForJti(jti: string): string {
    return `${this.keyPrefix}${jti}`;
  }

  private pruneCache(nowMs: number) {
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAtMs <= nowMs) {
        this.cache.delete(key);
      }
    }
    while (this.cache.size > CACHE_MAX_SIZE) {
      const oldestKey = this.cache.keys().next().value as string | undefined;
      if (!oldestKey) {
        break;
      }
      this.cache.delete(oldestKey);
    }
  }

  private pruneMemoryBlocklist(nowMs: number) {
    for (const [jti, expiresAtMs] of this.memoryBlocklist.entries()) {
      if (expiresAtMs <= nowMs) {
        this.memoryBlocklist.delete(jti);
      }
    }
  }

  private async ensureRedisConnection(): Promise<void> {
    if (this.isRedisDisabled()) {
      this.redisAvailable = false;
      return;
    }
    if (this.redisAvailable) {
      return;
    }
    const nowMs = Date.now();
    if (nowMs < this.redisRetryAfterMs) {
      return;
    }
    if (this.redisConnecting) {
      await this.redisConnecting;
      return;
    }

    this.redisConnecting = (async () => {
      let pendingClient: ReturnType<typeof createClient> | null = null;
      try {
        const url = String(process.env.REDIS_URL ?? "").trim() || DEFAULT_REDIS_URL;
        const client = createClient({
          url,
          socket: {
            connectTimeout: 750,
          },
        });
        pendingClient = client;
        client.on("error", (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error ?? "unknown error");
          this.markRedisUnavailable(`Redis error for JWT blocklist: ${message}`);
        });
        await Promise.race([
          client.connect(),
          new Promise<never>((_, reject) => {
            setTimeout(() => reject(new Error("Redis connect timeout")), REDIS_CONNECT_TIMEOUT_MS);
          }),
        ]);
        this.redisClient = client;
        pendingClient = null;
        this.redisAvailable = true;
        this.redisRetryAfterMs = 0;
      } catch (error: unknown) {
        if (pendingClient) {
          await pendingClient.quit().catch(() => undefined);
        }
        const message = error instanceof Error ? error.message : String(error ?? "unknown error");
        this.markRedisUnavailable(`Redis unavailable for JWT blocklist; falling back to in-memory revocation only: ${message}`);
      } finally {
        this.redisConnecting = null;
      }
    })();

    await this.redisConnecting;
  }

  private markRedisUnavailable(message: string) {
    this.redisAvailable = false;
    this.redisRetryAfterMs = Date.now() + REDIS_RETRY_BACKOFF_MS;
    const nowMs = Date.now();
    if (nowMs - this.lastRedisWarnAtMs >= REDIS_WARN_THROTTLE_MS) {
      this.lastRedisWarnAtMs = nowMs;
      this.logger.warn(message);
    }
  }

  async revoke(jti: string, ttlSeconds: number): Promise<void> {
    const normalizedJti = jti.trim();
    if (!normalizedJti) {
      return;
    }
    const ttl = Math.max(1, Math.floor(ttlSeconds));
    const nowMs = Date.now();
    const expiresAtMs = nowMs + ttl * 1000;

    this.memoryBlocklist.set(normalizedJti, expiresAtMs);
    this.cache.set(normalizedJti, { value: true, expiresAtMs: nowMs + CACHE_TTL_MS });
    this.pruneMemoryBlocklist(nowMs);
    this.pruneCache(nowMs);

    await this.ensureRedisConnection();
    if (!this.redisAvailable || !this.redisClient) {
      return;
    }

    try {
      await this.redisClient.setEx(this.keyForJti(normalizedJti), ttl, "1");
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error ?? "unknown error");
      this.markRedisUnavailable(`Failed writing JWT blocklist key for jti=${normalizedJti}: ${message}`);
    }
  }

  async isRevoked(jti: string): Promise<boolean> {
    const normalizedJti = jti.trim();
    if (!normalizedJti) {
      return false;
    }
    const nowMs = Date.now();
    this.pruneMemoryBlocklist(nowMs);
    this.pruneCache(nowMs);

    const memoryExpiry = this.memoryBlocklist.get(normalizedJti);
    if (memoryExpiry && memoryExpiry > nowMs) {
      this.cache.set(normalizedJti, { value: true, expiresAtMs: nowMs + CACHE_TTL_MS });
      return true;
    }

    const cached = this.cache.get(normalizedJti);
    if (cached && cached.expiresAtMs > nowMs) {
      return cached.value;
    }

    await this.ensureRedisConnection();
    if (!this.redisAvailable || !this.redisClient) {
      if (process.env["JWT_BLOCKLIST_FAIL_OPEN"] === "true") {
        this.cache.set(normalizedJti, { value: false, expiresAtMs: nowMs + CACHE_TTL_MS });
        return false;
      }
      throw new UnauthorizedException("Auth service temporarily unavailable.");
    }

    try {
      const exists = Number(await this.redisClient.exists(this.keyForJti(normalizedJti)));
      const revoked = exists > 0;
      this.cache.set(normalizedJti, { value: revoked, expiresAtMs: nowMs + CACHE_TTL_MS });
      return revoked;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error ?? "unknown error");
      this.markRedisUnavailable(`Failed reading JWT blocklist key for jti=${normalizedJti}: ${message}`);
      this.cache.set(normalizedJti, { value: false, expiresAtMs: nowMs + CACHE_TTL_MS });
      return false;
    }
  }

  // ── Credential-level revocation ──────────────────────────────────────────
  // When a password is changed, all tokens issued before that moment are
  // invalidated even if their JTIs are not individually blocklisted.

  private credRevKey(tenantKey: string, userId: string): string {
    return `cred_rev:${tenantKey}:${userId}`;
  }

  async revokeCredentials(tenantKey: string, userId: string): Promise<void> {
    const key = this.credRevKey(tenantKey, userId);
    const epochSeconds = Math.floor(Date.now() / 1000);
    this.credRevCache.set(key, {
      epoch: epochSeconds,
      expiresAtMs: Date.now() + CRED_REV_TTL_SECONDS * 1000,
    });

    await this.ensureRedisConnection();
    if (!this.redisAvailable || !this.redisClient) {
      return;
    }
    try {
      await this.redisClient.setEx(key, CRED_REV_TTL_SECONDS, String(epochSeconds));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error ?? "unknown");
      this.markRedisUnavailable(`Failed writing cred_rev key ${key}: ${message}`);
    }
  }

  async isCredentialRevoked(tenantKey: string, userId: string, iat: number): Promise<boolean> {
    const key = this.credRevKey(tenantKey, userId);
    const nowMs = Date.now();

    const cached = this.credRevCache.get(key);
    if (cached && cached.expiresAtMs > nowMs) {
      return iat < cached.epoch;
    }

    await this.ensureRedisConnection();
    if (!this.redisAvailable || !this.redisClient) {
      if (process.env["JWT_BLOCKLIST_FAIL_OPEN"] === "true") {
        return false;
      }
      throw new UnauthorizedException("Auth service temporarily unavailable.");
    }
    try {
      const raw = await this.redisClient.get(key);
      if (!raw) {
        this.credRevCache.set(key, { epoch: 0, expiresAtMs: nowMs + CRED_REV_CACHE_TTL_MS });
        return false;
      }
      const epoch = parseInt(raw, 10);
      if (!Number.isFinite(epoch)) {
        return false;
      }
      this.credRevCache.set(key, { epoch, expiresAtMs: nowMs + CRED_REV_CACHE_TTL_MS });
      return iat < epoch;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error ?? "unknown");
      this.markRedisUnavailable(`Failed reading cred_rev key ${key}: ${message}`);
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redisClient) {
      await this.redisClient.quit().catch(() => undefined);
      this.redisClient = null;
    }
    this.redisAvailable = false;
  }
}
