import { Injectable } from "@nestjs/common";
import { LoggerService } from "../common/logging/logger.service";

export interface ConnectorFetchInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string | URLSearchParams | Buffer;
  timeoutMs?: number;
}

// Per-connector rate limits: capacity (burst) and refill rate (ms per token = 1/req-per-sec * 1000)
const RATE_LIMIT_DEFAULTS: Record<string, { capacity: number; refillMs: number }> = {
  "amazon-in": { capacity: 5,  refillMs: 200  }, // 5 burst, 5 req/sec sustained
  "shopify":   { capacity: 10, refillMs: 500  }, // 10 burst, 2 req/sec sustained
  "flipkart":  { capacity: 3,  refillMs: 1000 }, // 3 burst, 1 req/sec sustained
  "meesho":    { capacity: 2,  refillMs: 1000 }, // 2 burst, 1 req/sec sustained
};
const DEFAULT_RATE_LIMIT = { capacity: 5, refillMs: 500 };

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;
const BASE_BACKOFF_MS = 1_000;
const MAX_BACKOFF_MS = 30_000;
const RETRY_ON_STATUS = new Set([429, 500, 502, 503, 504]);

class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private readonly capacity: number,
    private readonly refillMs: number,
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  async consume(): Promise<void> {
    this.refill();
    if (this.tokens >= 1) {
      this.tokens--;
      return;
    }
    const waitMs = this.refillMs * (1 - this.tokens);
    await delay(Math.max(0, Math.ceil(waitMs)));
    this.refill();
    this.tokens = Math.max(0, this.tokens - 1);
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const refilled = elapsed / this.refillMs;
    if (refilled >= 1) {
      this.tokens = Math.min(this.capacity, this.tokens + Math.floor(refilled));
      this.lastRefill = now;
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitter(baseMs: number): number {
  // ±20% jitter to spread retries across concurrent requests
  return Math.floor(baseMs * (0.8 + Math.random() * 0.4));
}

function parseRetryAfterMs(headers: Headers): number | null {
  const raw = headers.get("retry-after") ?? headers.get("Retry-After");
  if (!raw) return null;
  const seconds = parseFloat(raw);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(Math.ceil(seconds * 1000), MAX_BACKOFF_MS);
  }
  return null;
}

@Injectable()
export class ConnectorHttpClient {
  private readonly buckets = new Map<string, TokenBucket>();

  constructor(private readonly logger: LoggerService) {}

  /**
   * Rate-limited, retrying fetch for marketplace API calls.
   *
   * Handles:
   *   - Per-connector token bucket rate limiting (keyed by slug:installationId)
   *   - Exponential backoff with jitter on 429/500/502/503/504
   *   - Retry-After header on 429
   *   - Configurable timeout via timeoutMs (default 30s)
   *
   * Does NOT retry on 400/401/403/404 — those are permanent errors.
   */
  async fetch(
    slug: string,
    installationId: string,
    url: string,
    init: ConnectorFetchInit = {},
  ): Promise<Response> {
    const bucketKey = `${slug}:${installationId}`;
    const bucket = this.getOrCreateBucket(slug, bucketKey);
    const timeoutMs = init.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    let lastError: unknown;

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await bucket.consume();

      let response: Response;
      try {
        response = await fetch(url, {
          method: init.method ?? "GET",
          headers: init.headers,
          body: init.body as BodyInit | undefined,
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (err) {
        lastError = err;
        // Network error or timeout — retry with backoff
        const isLastAttempt = attempt >= MAX_RETRIES;
        if (isLastAttempt) break;

        const backoffMs = jitter(Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS));
        this.logger.warn("connector.http.network_error", {
          slug,
          url,
          attempt,
          backoffMs,
          error: err instanceof Error ? err.message : String(err),
        });
        await delay(backoffMs);
        continue;
      }

      if (!RETRY_ON_STATUS.has(response.status)) {
        return response;
      }

      const isLastAttempt = attempt >= MAX_RETRIES;
      if (isLastAttempt) {
        return response;
      }

      const retryAfterMs = response.status === 429 ? parseRetryAfterMs(response.headers) : null;
      const backoffMs = retryAfterMs ?? jitter(Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS));

      this.logger.warn("connector.http.retrying", {
        slug,
        url,
        status: response.status,
        attempt,
        backoffMs,
      });
      await delay(backoffMs);
    }

    if (lastError) {
      throw lastError;
    }

    // Should not reach here — last response returned above
    throw new Error(`connector.http: exhausted retries for ${url}`);
  }

  private getOrCreateBucket(slug: string, key: string): TokenBucket {
    const existing = this.buckets.get(key);
    if (existing) return existing;

    const config = RATE_LIMIT_DEFAULTS[slug] ?? DEFAULT_RATE_LIMIT;
    const bucket = new TokenBucket(config.capacity, config.refillMs);
    this.buckets.set(key, bucket);
    return bucket;
  }
}
