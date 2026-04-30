import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { AdminBoundaryAccess } from "../common/rbac/admin-boundary.decorator";
import { DisallowApiClient } from "../common/rbac/api-client-policy.decorator";
import { ReadAccessPolicy } from "../common/rbac/read-access-policy.decorator";
import { type AppRole, Roles } from "../common/rbac/roles";
import { ApiKeysService } from "./api-keys.service";
import { CreateApiKeyDto } from "./dto/create-api-key.dto";

type AuthenticatedRequest = Request & {
  pimUserId?: string;
  pimTenant?: string;
  pimRole?: AppRole;
  pimJwtClaims?: {
    sub?: string;
    tenantId?: string;
    role?: AppRole;
  };
};

@Controller("admin/api-keys")
@DisallowApiClient()
@ReadAccessPolicy("api_keys_governance_redacted")
@AdminBoundaryAccess({ capability: "manage_security" })
@Roles("admin")
export class ApiKeysController {
  constructor(private readonly apiKeysService: ApiKeysService) {}

  @Get()
  listKeys(@Req() request: AuthenticatedRequest) {
    const actor = this.requireActor(request);
    return this.apiKeysService.listKeys(actor.tenantId);
  }

  @Post()
  createKey(@Req() request: AuthenticatedRequest, @Body() dto: CreateApiKeyDto) {
    const actor = this.requireActor(request);
    return this.apiKeysService.createKey(actor.tenantId, actor.userId, actor.role, dto);
  }

  @Post(":id/revoke")
  @HttpCode(200)
  revokeKey(@Req() request: AuthenticatedRequest, @Param("id") keyId: string) {
    const actor = this.requireActor(request);
    return this.apiKeysService.revokeKey(actor.tenantId, actor.userId, actor.role, decodeURIComponent(keyId));
  }

  private requireActor(request: AuthenticatedRequest): { userId: string; tenantId: string; role: AppRole } {
    const userId = request.pimUserId ?? request.pimJwtClaims?.sub;
    const tenantId = request.pimTenant ?? request.pimJwtClaims?.tenantId;
    const role = request.pimRole ?? request.pimJwtClaims?.role;
    if (!userId || !tenantId || !role) {
      throw new UnauthorizedException("Authenticated actor is required.");
    }
    return { userId, tenantId, role };
  }
}
