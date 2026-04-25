import { Body, Controller, Delete, Get, Param, Post, Req, UnauthorizedException } from "@nestjs/common";
import { FastifyRequest } from "fastify";
import { AccessPolicyService } from "../common/access-policy/access-policy.service";
import { AppRole, Roles } from "../common/rbac/roles";
import { CreateAccessScopeAssignmentDto } from "./dto/create-access-scope-assignment.dto";

type AuthenticatedRequest = FastifyRequest & {
  pimJwtClaims?: {
    sub?: string;
    tenantId?: string;
    role?: AppRole;
  };
  pimRole?: AppRole;
  pimTenant?: string;
  pimUserId?: string;
};

@Controller("admin/workspace/access-scopes")
@Roles("admin")
export class WorkspaceAccessScopesController {
  constructor(private readonly accessPolicyService: AccessPolicyService) {}

  @Get()
  listAccessScopes(@Req() request: AuthenticatedRequest) {
    const actor = this.requireActor(request);
    return this.accessPolicyService.listScopeAssignments(actor.tenantId);
  }

  @Post()
  createAccessScope(@Body() dto: CreateAccessScopeAssignmentDto, @Req() request: AuthenticatedRequest) {
    const actor = this.requireActor(request);
    return this.accessPolicyService.createScopeAssignment(actor.tenantId, {
      actorId: actor.userId,
      actorRole: actor.role,
      tenantId: actor.tenantId,
    }, dto);
  }

  @Delete(":assignmentId")
  deleteAccessScope(@Param("assignmentId") assignmentId: string, @Req() request: AuthenticatedRequest) {
    const actor = this.requireActor(request);
    return this.accessPolicyService.deleteScopeAssignment(actor.tenantId, assignmentId, {
      actorId: actor.userId,
      actorRole: actor.role,
      tenantId: actor.tenantId,
    });
  }

  private requireActor(request: AuthenticatedRequest): { userId: string; tenantId: string; role: AppRole } {
    const userId = request.pimUserId ?? request.pimJwtClaims?.sub;
    const tenantId = request.pimTenant ?? request.pimJwtClaims?.tenantId;
    const role = request.pimRole ?? request.pimJwtClaims?.role;
    if (!userId || !tenantId || !role) {
      throw new UnauthorizedException("Bearer token is required.");
    }
    return { userId, tenantId, role };
  }
}
