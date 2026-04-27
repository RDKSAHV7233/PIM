import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from "@nestjs/common";
import { PlanGuard } from "../billing/plan-guard.guard";
import { RequirePlanLimit } from "../billing/require-plan-limit.decorator";
import { DisallowApiClient } from "../common/rbac/api-client-policy.decorator";
import { CursorPaginationDto } from "../common/pagination/cursor-pagination.dto";
import { ReadAccessPolicy } from "../common/rbac/read-access-policy.decorator";
import { AppRole } from "../common/rbac/roles";
import { DEFAULT_MARKETPLACE_CHANNEL } from "../marketplace/marketplace-channels";
import { BulkMediaAssociationDto } from "./dto/bulk-media-association.dto";
import { CreateMediaAssetDto } from "./dto/create-media-asset.dto";
import { MediaService } from "./media.service";

@Controller("media")
@DisallowApiClient()
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  private resolveActor(request: { pimUserId?: string; pimRole?: AppRole; pimTenant?: string }) {
    return {
      actorId: request.pimUserId,
      actorRole: request.pimRole,
      tenantId: request.pimTenant,
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
  @ReadAccessPolicy("media_assets_scoped")
  listAssets(
    @Query("productId") productId?: string,
    @Query("variantId") variantId?: string,
    @Query() pagination?: CursorPaginationDto,
    @Req() request?: { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.mediaService.listAssets(productId, variantId, pagination, this.resolveActor(request ?? {}));
  }

  @Get("assets/:id")
  @ReadAccessPolicy("media_assets_scoped")
  getAsset(
    @Param("id") id: string,
    @Req() request: { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.mediaService.getAsset(id, this.resolveActor(request));
  }

  @Get("assets/:id/validation")
  @ReadAccessPolicy("media_assets_scoped")
  validateAsset(
    @Param("id") id: string,
    @Query("channel") channel = DEFAULT_MARKETPLACE_CHANNEL,
    @Req() request: { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.mediaService.validateAsset(id, channel, this.resolveActor(request));
  }

  @Post("bulk-associations")
  bulkAssociate(
    @Body() dto: BulkMediaAssociationDto,
    @Req() request: { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.mediaService.bulkAssociate(dto, this.resolveActor(request));
  }
}
