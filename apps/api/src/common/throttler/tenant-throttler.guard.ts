import { ExecutionContext, Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";
import type { Request } from "express";

interface PimRequest extends Request {
  pimTenant?: string;
  pimUserId?: string;
}

@Injectable()
export class TenantThrottlerGuard extends ThrottlerGuard {
  override async canActivate(context: ExecutionContext): Promise<boolean> {
    if (String(process.env.PIM_DISABLE_THROTTLER ?? "").trim().toLowerCase() === "true") {
      return true;
    }
    return (await super.canActivate(context)) as boolean;
  }

  protected generateKey(context: ExecutionContext, suffix: string, throttlerName: string): string {
    if (throttlerName === "tenant") {
      const request = context.switchToHttp().getRequest<PimRequest>();
      const tenantKey = request.pimTenant ?? "unknown";
      return `throttle_tenant_${tenantKey}_${suffix}`;
    }
    if (throttlerName === "user") {
      const request = context.switchToHttp().getRequest<PimRequest>();
      const userId = request.pimUserId ?? "anonymous";
      return `throttle_user_${userId}_${suffix}`;
    }
    return super.generateKey(context, suffix, throttlerName);
  }
}
