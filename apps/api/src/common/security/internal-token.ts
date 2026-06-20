import { HttpException, HttpStatus, UnauthorizedException } from "@nestjs/common";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Request } from "express";

type TokenFailureReason = "missing_or_invalid" | "rate_limited";

type TokenFailureEvent = {
  routeKey: string;
  reason: TokenFailureReason;
  remoteAddress: string;
  retryAfterSeconds?: number;
};

type InternalTokenOptions = {
  routeKey: string;
  expectedToken: string | undefined;
  submittedToken: string | undefined;
  request?: Request;
  maxInvalidAttempts?: number;
  windowMs?: number;
  onFailure?: (event: TokenFailureEvent) => Promise<void> | void;
};

type FailureBucket = {
  count: number;
  resetAt: number;
};

const DEFAULT_MAX_INVALID_ATTEMPTS = 10;
const DEFAULT_WINDOW_MS = 60_000;
const failureBuckets = new Map<string, FailureBucket>();

function digestToken(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function secureTokenEquals(submittedToken: string | undefined, expectedToken: string | undefined): boolean {
  const submitted = String(submittedToken ?? "").trim();
  const expected = String(expectedToken ?? "").trim();
  if (!submitted || !expected) {
    return false;
  }
  return timingSafeEqual(digestToken(submitted), digestToken(expected));
}

function resolveRemoteAddress(request: Request | undefined): string {
  // Express populates req.ip from X-Forwarded-For when app.set('trust proxy', 1) is set.
  return String(request?.ip ?? request?.socket?.remoteAddress ?? "unknown").trim() || "unknown";
}

function resolveBucket(key: string, now: number, windowMs: number): FailureBucket {
  const existing = failureBuckets.get(key);
  if (existing && existing.resetAt > now) {
    return existing;
  }
  const bucket = {
    count: 0,
    resetAt: now + windowMs,
  };
  failureBuckets.set(key, bucket);
  return bucket;
}

async function recordFailure(
  onFailure: InternalTokenOptions["onFailure"],
  event: TokenFailureEvent,
): Promise<void> {
  try {
    await onFailure?.(event);
  } catch {
    // Failure telemetry must not leak or alter the auth response path.
  }
}

export async function requireInternalToken(options: InternalTokenOptions): Promise<void> {
  const now = Date.now();
  const routeKey = String(options.routeKey || "internal-token").trim();
  const remoteAddress = resolveRemoteAddress(options.request);
  const bucketKey = `${routeKey}:${remoteAddress}`;
  const maxInvalidAttempts = Math.max(1, Math.floor(options.maxInvalidAttempts ?? DEFAULT_MAX_INVALID_ATTEMPTS));
  const windowMs = Math.max(1_000, Math.floor(options.windowMs ?? DEFAULT_WINDOW_MS));
  const bucket = resolveBucket(bucketKey, now, windowMs);

  if (bucket.count >= maxInvalidAttempts) {
    const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
    await recordFailure(options.onFailure, {
      routeKey,
      reason: "rate_limited",
      remoteAddress,
      retryAfterSeconds,
    });
    throw new HttpException(
      {
        error: "INTERNAL_TOKEN_RATE_LIMITED",
        retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  if (!secureTokenEquals(options.submittedToken, options.expectedToken)) {
    bucket.count += 1;
    await recordFailure(options.onFailure, {
      routeKey,
      reason: "missing_or_invalid",
      remoteAddress,
    });
    throw new UnauthorizedException({ error: "INTERNAL_TOKEN_REQUIRED" });
  }

  failureBuckets.delete(bucketKey);
}
