import { ExecutionContext, Injectable } from "@nestjs/common";
import { RetryAfterThrottlerGuard } from "./retry-after-throttler.guard";

const ENFORCED_THROTTLER_NAMES = new Set(["ip"]);

/**
 * Cheap, IP-keyed first line of defense against abusive traffic — runs before
 * JwtAuthGuard so unauthenticated requests are bounded before paying for JWT
 * verification, Redis blocklist checks, or API-key hashing/DB lookups.
 *
 * Only enforces the "ip" throttler (filtered in onModuleInit): identity-aware
 * limits (per-tenant, per-user, per-API-key) live in IdentityThrottlerGuard,
 * which runs after JwtAuthGuard once a principal is actually resolved.
 */
@Injectable()
export class PreAuthIpThrottlerGuard extends RetryAfterThrottlerGuard {
  override async onModuleInit(): Promise<void> {
    await super.onModuleInit();
    this.throttlers = this.throttlers.filter((t) => ENFORCED_THROTTLER_NAMES.has(t.name ?? ""));
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    if (String(process.env.PIM_DISABLE_THROTTLER ?? "").trim().toLowerCase() === "true") {
      return true;
    }
    return (await super.canActivate(context)) as boolean;
  }
}
