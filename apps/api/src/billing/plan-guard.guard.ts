import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { PLAN_RESOURCE_KEY, PlanResource } from "./require-plan-limit.decorator";
import { PlanUsageService } from "./plan-usage.service";

type GuardRequest = Request & {
  pimTenant?: string;
  body?: Record<string, unknown>;
  params?: Record<string, unknown>;
};

@Injectable()
export class PlanGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly planUsageService: PlanUsageService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const resourceOrList = this.reflector.getAllAndOverride<PlanResource | PlanResource[]>(PLAN_RESOURCE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!resourceOrList) {
      return true;
    }
    const resources = Array.isArray(resourceOrList) ? resourceOrList : [resourceOrList];

    const request = context.switchToHttp().getRequest<GuardRequest>();
    for (const resource of resources) {
      const delta = this.estimateDelta(resource, request.body);
      const connectorSlug =
        resource === "connector_accounts"
          ? String(request.params?.slug ?? "").trim().toLowerCase() || undefined
          : undefined;
      const check = await this.planUsageService.checkLimit(resource, delta, request.pimTenant, {
        connectorSlug,
      });
      if (check.allowed) {
        continue;
      }

      throw new HttpException(
        {
          error: "PLAN_LIMIT_EXCEEDED",
          resource: check.resource,
          limit: check.limit,
          current: check.current,
          upgrade_url: "/admin/plan",
        },
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    return true;
  }

  private estimateDelta(resource: PlanResource, body: Record<string, unknown> | undefined): number {
    if (resource !== "storage_gb") {
      return 1;
    }
    const contentBase64 = typeof body?.contentBase64 === "string" ? body.contentBase64 : "";
    if (!contentBase64) {
      return 0;
    }
    const estimatedBytes = Math.floor((contentBase64.length * 3) / 4);
    return estimatedBytes / (1024 * 1024 * 1024);
  }
}
