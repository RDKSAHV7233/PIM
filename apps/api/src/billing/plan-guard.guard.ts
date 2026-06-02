import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import { PLAN_RESOURCE_KEY, PlanResource } from "./require-plan-limit.decorator";
import { PlanUsageService } from "./plan-usage.service";

type GuardRequest = Request & {
  pimTenant?: string;
  pimAdminBoundaryRoles?: string[];
  body?: Record<string, unknown>;
  params?: Record<string, unknown>;
};

@Injectable()
export class PlanGuard implements CanActivate {
  private readonly logger = new Logger(PlanGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly planUsageService: PlanUsageService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // ── Dev-mode quota bypass ────────────────────────────────────────────────
    // When PIM_PLAN_TIER_OVERRIDE is set AND APP_ENV=development, skip all
    // quota checks entirely. This prevents load/stress tests from consuming
    // monthly submission counters and hitting PLAN_LIMIT_EXCEEDED mid-run.
    // The guard is locked to APP_ENV=development — staging and production
    // are immune regardless of the env var value.
    // Set PIM_PLAN_GUARD_FORCE_ENFORCE=true to override this bypass in E2E
    // tests that need to verify plan-limit enforcement in dev mode.
    const appEnv = String(process.env.APP_ENV ?? "").trim().toLowerCase();
    const tierOverride = String(process.env.PIM_PLAN_TIER_OVERRIDE ?? "").trim().toUpperCase();
    const forceEnforce = String(process.env.PIM_PLAN_GUARD_FORCE_ENFORCE ?? "").trim().toLowerCase();
    if (tierOverride && appEnv === "development" && forceEnforce !== "true") {
      this.logger.warn(
        `Quota check bypassed: PIM_PLAN_TIER_OVERRIDE=${tierOverride} (APP_ENV=development). ` +
          `Remove PIM_PLAN_TIER_OVERRIDE before deploying to staging or production.`,
      );
      return true;
    }
    // ────────────────────────────────────────────────────────────────────────

    const resourceOrList = this.reflector.getAllAndOverride<PlanResource | PlanResource[]>(PLAN_RESOURCE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!resourceOrList) {
      return true;
    }
    const resources = Array.isArray(resourceOrList) ? resourceOrList : [resourceOrList];

    const request = context.switchToHttp().getRequest<GuardRequest>();

    // ── Boundary role bypass ─────────────────────────────────────────────────
    // product_admin and system_admin have unlimited access — they operate across
    // tenants and must not be blocked by per-tenant plan limits.
    // We log every bypass so capacity-planning dashboards can track over-limit
    // operations performed by internal roles.
    const boundaryRoles = Array.isArray(request.pimAdminBoundaryRoles)
      ? request.pimAdminBoundaryRoles
      : [];
    if (boundaryRoles.includes("product_admin") || boundaryRoles.includes("system_admin")) {
      this.logger.log(
        JSON.stringify({
          event: "PLAN_GUARD_BOUNDARY_BYPASS",
          tenant: request.pimTenant ?? "unknown",
          boundaryRoles,
          resources: resources.map((r) => r),
          path: request.url ?? "unknown",
          method: request.method ?? "unknown",
        }),
      );
      return true;
    }
    // ────────────────────────────────────────────────────────────────────────

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

      const contactUrl = String(process.env.PIM_COMMERCIAL_CONTACT_URL ?? "").trim() || null;
      throw new HttpException(
        {
          error: "PLAN_LIMIT_EXCEEDED",
          resource: check.resource,
          limit: check.limit,
          current: check.current,
          upgrade_url: "/admin/plan",
          contact_url: contactUrl,
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
