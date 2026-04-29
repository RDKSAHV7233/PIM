import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { FastifyRequest } from "fastify";
import { AuditService } from "../../audit/audit.service";
import { AccessPolicyService, type AccessPolicyDecisionContext, type PolicyActor } from "../access-policy/access-policy.service";
import {
  ADMIN_BOUNDARY_ACCESS_KEY,
  type AdminBoundaryAccessConfig,
} from "./admin-boundary.decorator";
import {
  FOUNDATION_ROLE_ACCESS_KEY,
  type FoundationRoleAccessConfig,
} from "./foundation-role-access.decorator";
import {
  API_CLIENT_ROUTE_POLICY_KEY,
  API_CLIENT_REQUIRED_SCOPES_KEY,
  DISALLOW_API_CLIENT_KEY,
  type ApiClientScope,
  type ApiClientRoutePolicy,
} from "./api-client-policy.decorator";
import {
  AUTHENTICATED_READ_ROUTE_KEY,
  READ_ACCESS_POLICY_KEY,
  resolveReadAccessPolicyConfig,
  type AuthenticatedReadRouteConfig,
  type ReadAccessPolicyId,
  readAccessPolicyReasonCode,
} from "./read-access-policy.decorator";
import { APP_ROLES, AppRole, DEFAULT_WRITE_ROLES, ROLES_KEY } from "./roles";
import { hasAdminBoundaryCapability, hasAdminBoundaryRole, resolveDefaultRole } from "./role-utils";
import { IS_PUBLIC_KEY } from "../../auth/public.decorator";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
type AuthenticatedRequest = FastifyRequest & {
  pimRole?: AppRole;
  pimTenant?: string;
  pimUserId?: string;
  pimAuthType?: "user_jwt" | "api_key";
  pimEffectiveRoles?: string[];
  pimAdminBoundaryRoles?: string[];
  pimApiScopes?: string[];
};

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
    private readonly accessPolicyService: AccessPolicyService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const handlerRoles = this.reflector.getAllAndOverride<AppRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const readAccessPolicy = this.reflector.getAllAndOverride<ReadAccessPolicyId>(READ_ACCESS_POLICY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const readRouteConfig = this.reflector.getAllAndOverride<AuthenticatedReadRouteConfig>(AUTHENTICATED_READ_ROUTE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const adminBoundaryAccess = this.reflector.getAllAndOverride<AdminBoundaryAccessConfig>(ADMIN_BOUNDARY_ACCESS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const foundationRoleAccess = this.reflector.getAllAndOverride<FoundationRoleAccessConfig>(FOUNDATION_ROLE_ACCESS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const apiClientPolicy = this.resolveApiClientPolicy(context, readAccessPolicy, readRouteConfig);
    const requiredApiClientScopes = this.resolveApiClientRequiredScopes(context);

    if (!request.pimRole) {
      request.pimRole = resolveDefaultRole();
    }
    const actorRole = request.pimRole;

    if (!request.pimTenant) {
      throw new ForbiddenException("Tenant context is required.");
    }

    const method = (request.method ?? "GET").toUpperCase();
    const disallowApiClient =
      this.reflector.getAllAndOverride<boolean>(DISALLOW_API_CLIENT_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) === true;
    if (request.pimAuthType === "api_key") {
      const denialReason = this.resolveApiClientDenialReason(
        apiClientPolicy,
        disallowApiClient,
        requiredApiClientScopes,
        request.pimApiScopes,
      );
      if (denialReason) {
        await this.recordShadowDecision(request, false, denialReason, {
          disallowApiClient: disallowApiClient || denialReason === "API_CLIENT_FORBIDDEN",
          apiClientPolicy,
          requiredApiClientScopes,
          readClassification: readRouteConfig?.classification ?? null,
        });
        await this.recordDeniedAttempt(request, {
          reasonCode: denialReason,
        });
        throw new ForbiddenException({
          error: "ACCESS_POLICY_DENIED",
          reason: denialReason,
          action: `${method} ${request.url ?? "unknown"}`,
          resource: request.url ?? "unknown",
        });
      }
    }

    const foundationRoleDenial = this.resolveFoundationRoleDenialReason(request, foundationRoleAccess);
    if (foundationRoleDenial) {
      await this.recordShadowDecision(request, false, foundationRoleDenial, {
        requiredRoles: handlerRoles,
        requiredAdminCapability: adminBoundaryAccess?.capability ?? null,
        requiredAdminBoundaryRoles: adminBoundaryAccess?.allowedRoles ?? null,
        allowLegacyAdminFallback: adminBoundaryAccess?.allowLegacyAdminFallback !== false,
        effectiveRoles: request.pimEffectiveRoles ?? [],
        allowedFoundationRoles: foundationRoleAccess?.allowedRoles ?? [],
        apiClientPolicy,
        requiredApiClientScopes,
        readClassification: readRouteConfig?.classification ?? null,
      });
      await this.recordDeniedAttempt(request, {
        reasonCode: foundationRoleDenial,
        requiredRoles: handlerRoles,
      });
      throw new ForbiddenException({
        error: "ACCESS_POLICY_DENIED",
        reason: foundationRoleDenial,
        action: `${method} ${request.url ?? "unknown"}`,
        resource: request.url ?? "unknown",
      });
    }

    if (adminBoundaryAccess) {
      const deniedReason = this.resolveAdminBoundaryDenialReason(request, adminBoundaryAccess);
      if (deniedReason) {
        await this.recordShadowDecision(request, false, deniedReason, {
          requiredRoles: handlerRoles,
          requiredAdminCapability: adminBoundaryAccess.capability ?? null,
          requiredAdminBoundaryRoles: adminBoundaryAccess.allowedRoles ?? null,
          allowLegacyAdminFallback: adminBoundaryAccess.allowLegacyAdminFallback !== false,
          effectiveRoles: request.pimEffectiveRoles ?? [],
          allowedFoundationRoles: foundationRoleAccess?.allowedRoles ?? [],
          apiClientPolicy,
          requiredApiClientScopes,
          readClassification: readRouteConfig?.classification ?? null,
        });
        await this.recordDeniedAttempt(request, {
          reasonCode: deniedReason,
          requiredRoles: handlerRoles,
        });
        throw new ForbiddenException({
          error: "ACCESS_POLICY_DENIED",
          reason: deniedReason,
          action: `${method} ${request.url ?? "unknown"}`,
          resource: request.url ?? "unknown",
        });
      }
    }

    if (handlerRoles && handlerRoles.length > 0) {
      if (!handlerRoles.includes(actorRole)) {
        await this.recordShadowDecision(request, false, "ROLE_FORBIDDEN", {
          requiredRoles: handlerRoles,
          requiredAdminCapability: adminBoundaryAccess?.capability ?? null,
          requiredAdminBoundaryRoles: adminBoundaryAccess?.allowedRoles ?? null,
          allowLegacyAdminFallback: adminBoundaryAccess?.allowLegacyAdminFallback !== false,
          effectiveRoles: request.pimEffectiveRoles ?? [],
          allowedFoundationRoles: foundationRoleAccess?.allowedRoles ?? [],
          apiClientPolicy,
          requiredApiClientScopes,
          readClassification: readRouteConfig?.classification ?? null,
        });
        await this.recordDeniedAttempt(request, {
          reasonCode: "ROLE_FORBIDDEN",
          requiredRoles: handlerRoles,
        });
        throw new ForbiddenException(`Role ${actorRole} cannot access this endpoint.`);
      }
      await this.recordShadowDecision(request, true, this.resolveAdminBoundaryAllowedReason(request, adminBoundaryAccess), {
        requiredRoles: handlerRoles,
        requiredAdminCapability: adminBoundaryAccess?.capability ?? null,
        requiredAdminBoundaryRoles: adminBoundaryAccess?.allowedRoles ?? null,
        allowLegacyAdminFallback: adminBoundaryAccess?.allowLegacyAdminFallback !== false,
        effectiveRoles: request.pimEffectiveRoles ?? [],
        allowedFoundationRoles: foundationRoleAccess?.allowedRoles ?? [],
        apiClientPolicy,
        requiredApiClientScopes,
        readClassification: readRouteConfig?.classification ?? null,
      });
      return true;
    }

    if (READ_METHODS.has(method)) {
      const readReasonCode = readAccessPolicy
        ? readAccessPolicyReasonCode(readAccessPolicy)
        : readRouteConfig
          ? `READ_CLASSIFIED_${String(readRouteConfig.classification ?? "unknown").toUpperCase()}`
          : this.isReadClassificationEnforced()
            ? "AUTHENTICATED_READ_CLASSIFICATION_REQUIRED"
            : "UNCLASSIFIED_AUTHENTICATED_READ_ALLOWED";
      const readAllowed = readAccessPolicy || readRouteConfig || !this.isReadClassificationEnforced();
      if (!readAllowed) {
        await this.recordShadowDecision(request, false, readReasonCode, {
          defaultReadAllowed: true,
          readAccessPolicy,
          readClassification: null,
          allowedFoundationRoles: foundationRoleAccess?.allowedRoles ?? [],
          apiClientPolicy,
          requiredApiClientScopes,
        });
        await this.recordDeniedAttempt(request, {
          reasonCode: readReasonCode,
        });
        throw new ForbiddenException({
          error: "ACCESS_POLICY_DENIED",
          reason: readReasonCode,
          action: `${method} ${request.url ?? "unknown"}`,
          resource: request.url ?? "unknown",
        });
      }
      await this.recordShadowDecision(
        request,
        true,
        readReasonCode,
        {
          defaultReadAllowed: !readAccessPolicy && !readRouteConfig,
          readAccessPolicy,
          readClassification: readRouteConfig?.classification ?? null,
          allowedFoundationRoles: foundationRoleAccess?.allowedRoles ?? [],
          apiClientPolicy,
          requiredApiClientScopes,
        },
      );
      return true;
    }
    if (!DEFAULT_WRITE_ROLES.includes(actorRole as (typeof APP_ROLES)[number])) {
      await this.recordShadowDecision(request, false, "WRITE_ROLE_REQUIRED", {
        defaultWriteRoles: DEFAULT_WRITE_ROLES,
        allowedFoundationRoles: foundationRoleAccess?.allowedRoles ?? [],
        apiClientPolicy,
        requiredApiClientScopes,
      });
      await this.recordDeniedAttempt(request, {
        reasonCode: "WRITE_ROLE_REQUIRED",
        requiredRoles: DEFAULT_WRITE_ROLES,
      });
      throw new ForbiddenException(`Role ${actorRole} cannot perform write operations.`);
    }
    await this.recordShadowDecision(request, true, "DEFAULT_WRITE_ALLOWED", {
      defaultWriteRoles: DEFAULT_WRITE_ROLES,
      allowedFoundationRoles: foundationRoleAccess?.allowedRoles ?? [],
      apiClientPolicy,
      requiredApiClientScopes,
    });
    return true;
  }

  private async recordDeniedAttempt(
    request: AuthenticatedRequest,
    options: {
      reasonCode: string;
      requiredRoles?: readonly AppRole[];
    },
  ): Promise<void> {
    await this.auditService.record({
      actorId: request.pimUserId ?? "unknown",
      actorRole: request.pimRole ?? "viewer",
      action: "AUTHORIZATION_DENIED",
      resource: request.url ?? "unknown",
      metadata: {
        result: "denied",
        reasonCode: options.reasonCode,
        method: request.method ?? "GET",
        path: request.url ?? null,
        tenantId: request.pimTenant ?? null,
        actorType: request.pimAuthType === "api_key" ? "api_client" : "human",
        requiredRoles: [...(options.requiredRoles ?? [])],
      },
    });
  }

  private async recordShadowDecision(
    request: AuthenticatedRequest,
    legacyAllowed: boolean,
    legacyReasonCode: string,
    context: Pick<
      AccessPolicyDecisionContext,
      | "requiredRoles"
      | "requiredAdminCapability"
      | "requiredAdminBoundaryRoles"
      | "allowLegacyAdminFallback"
      | "effectiveRoles"
      | "allowedFoundationRoles"
      | "defaultReadAllowed"
      | "defaultWriteRoles"
      | "disallowApiClient"
      | "readAccessPolicy"
      | "apiClientPolicy"
      | "requiredApiClientScopes"
      | "readClassification"
    >,
  ): Promise<void> {
    if (!this.isShadowModeEnabled()) {
      return;
    }
    const actor = this.resolvePolicyActor(request);
    const method = String(request.method ?? "GET").toUpperCase();
    const path = request.url ?? "unknown";
    const action = `${method} ${path}`;
    const resource = path;
    const policyDecision = this.accessPolicyService.can(actor, action, resource, {
      ...context,
      method,
      path,
    });
    if (policyDecision.allowed === legacyAllowed && policyDecision.reasonCode === legacyReasonCode) {
      return;
    }
    await this.accessPolicyService.recordShadowMismatch({
      actor,
      legacyDecision: {
        allowed: legacyAllowed,
        reasonCode: legacyReasonCode,
        actorType: actor.actorType ?? "human",
        action,
        resource,
        tenantId: actor.tenantId ?? null,
        context: {
          ...context,
          method,
          path,
        },
      },
      policyDecision,
    });
  }

  private resolvePolicyActor(request: AuthenticatedRequest): PolicyActor {
    return {
      actorId: request.pimUserId ?? null,
      actorRole: request.pimRole ?? "viewer",
      tenantId: request.pimTenant ?? null,
      actorType: request.pimAuthType === "api_key" ? "api_client" : "human",
      apiScopes: request.pimApiScopes ?? [],
    };
  }

  private isShadowModeEnabled(): boolean {
    const value = String(process.env.PIM_ACCESS_POLICY_SHADOW_MODE ?? "").trim().toLowerCase();
    return value === "true" || value === "1" || value === "yes";
  }

  private isReadClassificationEnforced(): boolean {
    const value = String(process.env.PIM_ENFORCE_READ_CLASSIFICATION ?? "true").trim().toLowerCase();
    return value === "true" || value === "1" || value === "yes";
  }

  private resolveApiClientPolicy(
    context: ExecutionContext,
    readAccessPolicy: ReadAccessPolicyId | null | undefined,
    readRouteConfig: AuthenticatedReadRouteConfig | null | undefined,
  ): ApiClientRoutePolicy | null {
    const explicit = this.reflector.getAllAndOverride<ApiClientRoutePolicy>(API_CLIENT_ROUTE_POLICY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (explicit) {
      return explicit;
    }
    if (readRouteConfig?.apiClientPolicy) {
      return readRouteConfig.apiClientPolicy;
    }
    if (readAccessPolicy) {
      return resolveReadAccessPolicyConfig(readAccessPolicy).apiClientPolicy;
    }
    return null;
  }

  private resolveApiClientRequiredScopes(context: ExecutionContext): ApiClientScope[] {
    return (
      this.reflector.getAllAndOverride<ApiClientScope[]>(API_CLIENT_REQUIRED_SCOPES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? []
    );
  }

  private resolveApiClientDenialReason(
    apiClientPolicy: ApiClientRoutePolicy | null,
    disallowApiClient: boolean,
    requiredApiClientScopes: readonly ApiClientScope[],
    grantedApiClientScopes: readonly string[] | undefined,
  ): string | null {
    if (apiClientPolicy === "allowed_with_api_scope") {
      if (requiredApiClientScopes.length === 0) {
        return "API_CLIENT_SCOPE_REQUIRED";
      }
      const granted = new Set((grantedApiClientScopes ?? []).map((scope) => String(scope).trim().toLowerCase()));
      const matched = requiredApiClientScopes.some((scope) => granted.has(scope));
      return matched ? null : "API_CLIENT_SCOPE_FORBIDDEN";
    }
    if (requiredApiClientScopes.length > 0) {
      return "API_CLIENT_SCOPE_NOT_APPLICABLE";
    }
    if (apiClientPolicy === "allowed_service_internal") {
      return "API_CLIENT_SERVICE_INTERNAL_ONLY";
    }
    if (apiClientPolicy === "not_applicable") {
      return "API_CLIENT_NOT_APPLICABLE";
    }
    if (disallowApiClient || apiClientPolicy === "denied_human_only" || apiClientPolicy === null) {
      return "API_CLIENT_FORBIDDEN";
    }
    return null;
  }

  private resolveAdminBoundaryDenialReason(
    request: AuthenticatedRequest,
    access: AdminBoundaryAccessConfig,
  ): string | null {
    const explicitBoundaryRoles = Array.isArray(request.pimAdminBoundaryRoles)
      ? request.pimAdminBoundaryRoles
      : [];
    if (explicitBoundaryRoles.length > 0) {
      if (access.allowedRoles && access.allowedRoles.length > 0) {
        return hasAdminBoundaryRole(explicitBoundaryRoles, access.allowedRoles) ? null : "ADMIN_BOUNDARY_FORBIDDEN";
      }
      if (access.capability) {
        return hasAdminBoundaryCapability(explicitBoundaryRoles, access.capability) ? null : "ADMIN_BOUNDARY_FORBIDDEN";
      }
      return "ADMIN_BOUNDARY_FORBIDDEN";
    }
    if (access.allowLegacyAdminFallback === false) {
      return "ADMIN_BOUNDARY_FORBIDDEN";
    }
    if (request.pimRole !== "admin") {
      return null;
    }
    return request.pimRole === "admin" ? null : "ADMIN_BOUNDARY_FORBIDDEN";
  }

  private resolveAdminBoundaryAllowedReason(
    request: AuthenticatedRequest,
    access: AdminBoundaryAccessConfig | null | undefined,
  ): string {
    if (!access) {
      return "ROLE_ALLOWED";
    }
    const explicitBoundaryRoles = Array.isArray(request.pimAdminBoundaryRoles)
      ? request.pimAdminBoundaryRoles
      : [];
    if (explicitBoundaryRoles.length > 0 || request.pimRole === "admin") {
      return "ADMIN_BOUNDARY_ALLOWED";
    }
    return "ROLE_ALLOWED";
  }

  private resolveFoundationRoleDenialReason(
    request: AuthenticatedRequest,
    access: FoundationRoleAccessConfig | null | undefined,
  ): string | null {
    const effectiveRoles = Array.isArray(request.pimEffectiveRoles) ? request.pimEffectiveRoles : [];
    const blockedRoles = effectiveRoles.filter((role) => role === "category_manager" || role === "vendor");
    if (blockedRoles.length === 0) {
      return null;
    }
    const allowedRoles = Array.isArray(access?.allowedRoles) ? access.allowedRoles : [];
    return blockedRoles.some((role) => allowedRoles.includes(role as "category_manager" | "vendor"))
      ? null
      : "FOUNDATION_ROLE_BLOCKED";
  }
}
