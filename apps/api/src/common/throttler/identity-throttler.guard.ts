import { ExecutionContext, Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import type { Request } from "express";

interface PimAuthenticatedRequest extends Request {
  pimAuthType?: "user_jwt" | "api_key";
  pimTenant?: string;
  pimUserId?: string;
  pimApiKeyId?: string;
}

const ENFORCED_THROTTLER_NAMES = new Set(["user", "tenant", "apiKey", "tenantApi"]);

/**
 * Identity-scoped rate limiting — runs after JwtAuthGuard, which is the only
 * place `pimAuthType`/`pimTenant`/`pimUserId`/`pimApiKeyId` get resolved.
 * Never authenticates a request itself (that would mean resolveApiKey() runs
 * twice per request); only reads what JwtAuthGuard already established.
 *
 * Per-request applicability is handled by each named throttler's own skipIf
 * in ThrottlerModule.forRoot() (app.module.ts) — "user"/"tenant" skip unless
 * pimAuthType === "user_jwt", "apiKey"/"tenantApi" skip unless "api_key".
 * onModuleInit() here additionally strips the pre-auth-only "ip" throttler
 * so it isn't double-enforced by this guard too.
 */
@Injectable()
export class IdentityThrottlerGuard extends ThrottlerGuard {
  override async onModuleInit(): Promise<void> {
    await super.onModuleInit();
    this.throttlers = this.throttlers.filter((t) => ENFORCED_THROTTLER_NAMES.has(t.name ?? ""));
  }

  protected override async shouldSkip(context: ExecutionContext): Promise<boolean> {
    if (String(process.env.PIM_DISABLE_THROTTLER ?? "").trim().toLowerCase() === "true") {
      return true;
    }
    const request = context.switchToHttp().getRequest<PimAuthenticatedRequest>();
    // No principal resolved (e.g. a @Public() route JwtAuthGuard let through
    // untouched) — nothing to key an identity-scoped limit on. The pre-auth
    // IP guard already covers this request.
    return !request.pimAuthType;
  }

  protected override generateKey(context: ExecutionContext, suffix: string, name: string): string {
    const request = context.switchToHttp().getRequest<PimAuthenticatedRequest>();
    const tenant = request.pimTenant ?? "unknown";
    switch (name) {
      case "user":
        return `throttle_user_${tenant}_${request.pimUserId ?? "unknown"}`;
      case "tenant":
        return `throttle_tenant_${tenant}`;
      case "apiKey":
        return `throttle_apikey_${request.pimApiKeyId ?? "unknown"}`;
      case "tenantApi":
        return `throttle_tenant_api_${tenant}`;
      default:
        return super.generateKey(context, suffix, name);
    }
  }
}
