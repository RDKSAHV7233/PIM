import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { FastifyRequest } from "fastify";
import { AuditService } from "../audit/audit.service";
import { AppRole } from "../common/rbac/roles";
import { PimJwtClaims, StepUpScope, extractBearerToken, verifyPimJwt } from "./jwt";
import { STEP_UP_REQUIRED_KEY, StepUpRequirement } from "./step-up.decorator";

export const PIM_STEP_UP_TOKEN_HEADER = "x-pim-step-up-token";

interface AuthenticatedRequest extends FastifyRequest {
  pimRole?: AppRole;
  pimTenant?: string;
  pimUserId?: string;
  pimJwtClaims?: PimJwtClaims;
}

@Injectable()
export class StepUpGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auditService: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requirement = this.reflector.getAllAndOverride<StepUpRequirement>(STEP_UP_REQUIRED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requirement) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const accessClaims = request.pimJwtClaims;
    if (!accessClaims) {
      throw new UnauthorizedException("Bearer token is required.");
    }

    const stepUpToken = this.extractStepUpToken(request.headers[PIM_STEP_UP_TOKEN_HEADER]);
    if (!stepUpToken) {
      await this.auditDenied(accessClaims, requirement.scope, requirement.action, "missing");
      throw new UnauthorizedException({ error: "STEP_UP_REQUIRED" });
    }

    const stepUpClaims = verifyPimJwt(stepUpToken);
    if (!stepUpClaims || stepUpClaims.tokenType !== "step_up") {
      await this.auditDenied(accessClaims, requirement.scope, requirement.action, "invalid");
      throw new UnauthorizedException({ error: "STEP_UP_TOKEN_INVALID" });
    }

    if (stepUpClaims.stepUpScope !== requirement.scope) {
      await this.auditDenied(accessClaims, requirement.scope, requirement.action, "scope_mismatch");
      throw new ForbiddenException({ error: "STEP_UP_SCOPE_MISMATCH" });
    }

    if (
      stepUpClaims.parentJti !== accessClaims.jti ||
      stepUpClaims.sub !== accessClaims.sub ||
      stepUpClaims.tenantId !== accessClaims.tenantId
    ) {
      await this.auditDenied(accessClaims, requirement.scope, requirement.action, "session_mismatch");
      throw new ForbiddenException({ error: "STEP_UP_TOKEN_SESSION_MISMATCH" });
    }

    return true;
  }

  private extractStepUpToken(value: unknown): string | null {
    const bearerToken = extractBearerToken(value);
    if (bearerToken) {
      return bearerToken;
    }
    if (typeof value !== "string") {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private async auditDenied(
    claims: PimJwtClaims,
    scope: StepUpScope,
    action: string,
    reason: string,
  ): Promise<void> {
    await this.auditService.record({
      actorId: claims.sub,
      actorRole: claims.role ?? "viewer",
      action: "auth.step_up_denied",
      resource: "marketplace.mapping_action",
      metadata: {
        scope,
        requiredAction: action,
        reason,
      },
    });
  }
}
