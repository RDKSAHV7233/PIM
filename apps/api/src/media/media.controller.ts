import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import type { Request } from "express";
import { PlanGuard } from "../billing/plan-guard.guard";
import { RequirePlanLimit } from "../billing/require-plan-limit.decorator";
import { ApiClientScopes, DisallowApiClient } from "../common/rbac/api-client-policy.decorator";
import { CursorPaginationDto } from "../common/pagination/cursor-pagination.dto";
import { FoundationRoleAccess } from "../common/rbac/foundation-role-access.decorator";
import { ReadAccessPolicy } from "../common/rbac/read-access-policy.decorator";
import { AppRole } from "../common/rbac/roles";
import { DEFAULT_MARKETPLACE_CHANNEL } from "../marketplace/marketplace-channels";
import { BulkMediaAssociationDto } from "./dto/bulk-media-association.dto";
import { CreateMediaAssetDto } from "./dto/create-media-asset.dto";
import { MediaService } from "./media.service";
import { UpdateMediaAssetGovernanceDto } from "./dto/update-media-asset-governance.dto";

type AuthenticatedRequest = {
  pimUserId?: string;
  pimRole?: AppRole;
  pimTenant?: string;
  pimEffectiveRoles?: string[];
};

@Controller("media")
@DisallowApiClient()
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  private resolveActor(request: AuthenticatedRequest) {
    return {
      actorId: request.pimUserId,
      actorRole: request.pimRole,
      tenantId: request.pimTenant,
      effectiveRoles: request.pimEffectiveRoles,
    };
  }

  @Post("assets")
  @UseGuards(PlanGuard)
  @RequirePlanLimit("storage_gb")
  createAsset(
    @Body() dto: CreateMediaAssetDto,
    @Req() request: { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.mediaService.createAsset(dto, this.resolveActor(request));
  }

  @Get("assets")
  @FoundationRoleAccess("vendor")
  @ReadAccessPolicy("media_assets_scoped")
  @ApiClientScopes("media.read")
  listAssets(
    @Query("productId") productId?: string,
    @Query("variantId") variantId?: string,
    @Query() pagination?: CursorPaginationDto,
    @Req() request?: Request & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string; pimEffectiveRoles?: string[] },
  ) {
    return this.mediaService.listAssets(productId, variantId, pagination, this.resolveActor(request ?? {}));
  }

  @Get("assets/:id")
  @FoundationRoleAccess("vendor")
  @ReadAccessPolicy("media_assets_scoped")
  @ApiClientScopes("media.read")
  getAsset(
    @Param("id") id: string,
    @Req() request: Request & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string; pimEffectiveRoles?: string[] },
  ) {
    return this.mediaService.getAsset(id, this.resolveActor(request));
  }

  @Get("assets/:id/validation")
  @FoundationRoleAccess("vendor")
  @ReadAccessPolicy("media_assets_scoped")
  @ApiClientScopes("media.read")
  validateAsset(
    @Param("id") id: string,
    @Query("channel") channel = DEFAULT_MARKETPLACE_CHANNEL,
    @Req() request: Request & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string; pimEffectiveRoles?: string[] },
  ) {
    return this.mediaService.validateAsset(id, channel, this.resolveActor(request));
  }

  @Patch("assets/:id/governance")
  updateGovernance(
    @Param("id") id: string,
    @Body() dto: UpdateMediaAssetGovernanceDto,
    @Req() request: Request & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string; pimEffectiveRoles?: string[] },
  ) {
    return this.mediaService.updateGovernance(id, dto, this.resolveActor(request));
  }

  @Post("bulk-associations")
  bulkAssociate(
    @Body() dto: BulkMediaAssociationDto,
    @Req() request: { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.mediaService.bulkAssociate(dto, this.resolveActor(request));
  }
}
