import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { AdminBoundaryAccess } from "../common/rbac/admin-boundary.decorator";
import { DisallowApiClient } from "../common/rbac/api-client-policy.decorator";
import { ReadAccessPolicy } from "../common/rbac/read-access-policy.decorator";
import { AppRole, Roles } from "../common/rbac/roles";
import { CreateWorkspaceUserDto } from "./dto/create-workspace-user.dto";
import { LockWorkspaceUserDto } from "./dto/lock-workspace-user.dto";
import { SetUserPasswordDto } from "./dto/set-user-password.dto";
import { UpdateWorkspaceUserRoleDto } from "./dto/update-workspace-user-role.dto";
import { WorkspaceUsersService } from "./workspace-users.service";

type AuthenticatedRequest = Request & {
  pimJwtClaims?: {
    sub?: string;
    tenantId?: string;
    role?: AppRole;
  };
  pimRole?: AppRole;
  pimTenant?: string;
  pimUserId?: string;
  pimAdminBoundaryRoles?: string[];
};

@Controller("admin/workspace/users")
@DisallowApiClient()
@ReadAccessPolicy("workspace_users_governance_redacted")
@AdminBoundaryAccess({ capability: "manage_users" })
@Roles("admin")
export class WorkspaceUsersController {
  constructor(private readonly workspaceUsersService: WorkspaceUsersService) {}

  @Get()
  listUsers(@Req() request: AuthenticatedRequest) {
    const actor = this.requireActor(request);
    return this.workspaceUsersService.listUsers(actor.tenantId);
  }

  @Post()
  createUser(
    @Body() dto: CreateWorkspaceUserDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const actor = this.requireActor(request);
    return this.workspaceUsersService.createUser(actor.tenantId, actor.userId, actor.role, dto, actor.adminBoundaryRoles);
  }

  @Patch(":userId/role")
  @HttpCode(200)
  updateUserRole(
    @Param("userId") userId: string,
    @Body() dto: UpdateWorkspaceUserRoleDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const actor = this.requireActor(request);
    return this.workspaceUsersService.updateUserRole(
      actor.tenantId,
      actor.userId,
      actor.role,
      decodeURIComponent(userId),
      dto,
      actor.adminBoundaryRoles,
    );
  }

  @Post(":userId/lock")
  @HttpCode(200)
  lockUser(
    @Param("userId") userId: string,
    @Body() dto: LockWorkspaceUserDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const actor = this.requireActor(request);
    return this.workspaceUsersService.lockUser(
      actor.tenantId,
      actor.userId,
      actor.role,
      decodeURIComponent(userId),
      dto,
    );
  }

  @Post(":userId/unlock")
  @HttpCode(200)
  unlockUser(@Param("userId") userId: string, @Req() request: AuthenticatedRequest) {
    const actor = this.requireActor(request);
    return this.workspaceUsersService.unlockUser(
      actor.tenantId,
      actor.userId,
      actor.role,
      decodeURIComponent(userId),
    );
  }

  @Post(":userId/deactivate")
  @HttpCode(200)
  deactivateUser(@Param("userId") userId: string, @Req() request: AuthenticatedRequest) {
    const actor = this.requireActor(request);
    return this.workspaceUsersService.deactivateUser(
      actor.tenantId,
      actor.userId,
      actor.role,
      decodeURIComponent(userId),
    );
  }

  @Post(":userId/password")
  @HttpCode(200)
  setUserPassword(
    @Param("userId") userId: string,
    @Body() dto: SetUserPasswordDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const actor = this.requireActor(request);
    return this.workspaceUsersService.setUserPassword(
      actor.tenantId,
      actor.userId,
      actor.role,
      decodeURIComponent(userId),
      dto.password,
    );
  }

  private requireActor(request: AuthenticatedRequest): { userId: string; tenantId: string; role: AppRole; adminBoundaryRoles: string[] } {
    const userId = request.pimUserId ?? request.pimJwtClaims?.sub;
    const tenantId = request.pimTenant ?? request.pimJwtClaims?.tenantId;
    const role = request.pimRole ?? request.pimJwtClaims?.role;
    const adminBoundaryRoles = Array.isArray(request.pimAdminBoundaryRoles) ? request.pimAdminBoundaryRoles : [];
    if (!userId || !tenantId || !role) {
      throw new UnauthorizedException("Bearer token is required.");
    }
    return { userId, tenantId, role, adminBoundaryRoles };
  }
}
