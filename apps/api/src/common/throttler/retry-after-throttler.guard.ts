import { ExecutionContext } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import type { ThrottlerLimitDetail } from "@nestjs/throttler";

/**
 * @nestjs/throttler only emits a per-throttler `Retry-After-<name>` header (e.g.
 * `Retry-After-ip`), which HTTP clients, SDKs and proxies do not understand. This base
 * adds the standard `Retry-After` (whole seconds) on the 429 so well-behaved clients back
 * off instead of retrying immediately. The per-throttler headers are left untouched.
 */
export abstract class RetryAfterThrottlerGuard extends ThrottlerGuard {
  protected override async throwThrottlingException(
    context: ExecutionContext,
    throttlerLimitDetail: ThrottlerLimitDetail,
  ): Promise<void> {
    const seconds = Math.max(1, Math.ceil(throttlerLimitDetail.timeToBlockExpire || throttlerLimitDetail.timeToExpire || 1));
    const { res } = this.getRequestResponse(context);
    if (typeof res?.header === "function") {
      res.header("Retry-After", String(seconds));
    }
    return super.throwThrottlingException(context, throttlerLimitDetail);
  }
}
