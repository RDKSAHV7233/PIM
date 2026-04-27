import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { map, Observable } from "rxjs";
import { AccessPolicyService, type PolicyActor } from "../access-policy/access-policy.service";
import {
  AUTHENTICATED_READ_ROUTE_KEY,
  READ_ACCESS_POLICY_KEY,
  resolveReadAccessPolicyConfig,
  type AuthenticatedReadRouteConfig,
  type ReadAccessPolicyId,
} from "./read-access-policy.decorator";
import type { AppRole } from "./roles";

type AuthenticatedRequest = {
  method?: string;
  pimUserId?: string;
  pimRole?: AppRole;
  pimTenant?: string;
  pimAuthType?: "user_jwt" | "api_key";
};

@Injectable()
export class ReadAccessPolicyInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly accessPolicyService: AccessPolicyService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const method = String(request?.method ?? "").trim().toUpperCase();
    if (method !== "GET" && method !== "HEAD") {
      return next.handle();
    }

    const routeConfig = this.reflector.getAllAndOverride<AuthenticatedReadRouteConfig>(AUTHENTICATED_READ_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const readAccessPolicy = this.reflector.getAllAndOverride<ReadAccessPolicyId>(READ_ACCESS_POLICY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const responseHandling =
      routeConfig?.responseHandling ??
      (readAccessPolicy ? resolveReadAccessPolicyConfig(readAccessPolicy).responseHandling : null);
    if (responseHandling !== "redact" || !readAccessPolicy) {
      return next.handle();
    }

    const actor: PolicyActor = {
      actorId: request?.pimUserId ?? null,
      actorRole: request?.pimRole ?? "viewer",
      tenantId: request?.pimTenant ?? null,
      actorType: request?.pimAuthType === "api_key" ? "api_client" : "human",
    };

    return next.handle().pipe(
      map((payload) => this.accessPolicyService.applyReadResponsePolicy(actor, readAccessPolicy, payload)),
    );
  }
}
