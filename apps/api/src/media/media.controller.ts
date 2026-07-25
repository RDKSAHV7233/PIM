import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res, StreamableFile, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { IsOptional, IsString, MaxLength } from "class-validator";
import { PlanGuard } from "../billing/plan-guard.guard";
import { RequirePlanLimit } from "../billing/require-plan-limit.decorator";
import { ApiClientScopes, DisallowApiClient } from "../common/rbac/api-client-policy.decorator";
import { CursorPaginationDto } from "../common/pagination/cursor-pagination.dto";
import { FoundationRoleAccess } from "../common/rbac/foundation-role-access.decorator";
import { ReadAccessPolicy } from "../common/rbac/read-access-policy.decorator";
import { AppRole } from "../common/rbac/roles";
import { DEFAULT_MARKETPLACE_CHANNEL } from "../marketplace/marketplace-channels";
import { Public } from "../auth/public.decorator";
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

class ListMediaAssetsQueryDto extends CursorPaginationDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  productId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  variantId?: string;
}

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
    @Query() query: ListMediaAssetsQueryDto,
    @Req() request?: Request & { pimUserId?: string; pimRole?: AppRole; pimTenant?: string; pimEffectiveRoles?: string[] },
  ) {
    return this.mediaService.listAssets(query.productId, query.variantId, query, this.resolveActor(request ?? {}));
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

  /**
   * Deliberately public/unauthenticated — this is what makes an uploaded asset fetchable by
   * external systems (e.g. Shopify pulling attributes.mainImageUrl). Same exposure profile as
   * a public R2 bucket URL: unguessable cuid id, no listing endpoint. See media.service.ts
   * getAssetFile() for the governed vs. ungoverned read-path split.
   */
  @Get("assets/:id/file")
  @Public()
  async getAssetFile(@Param("id") id: string, @Res({ passthrough: true }) response: Response) {
    const file = await this.mediaService.getAssetFile(id);
    if (file.redirectUrl) {
      response.redirect(302, file.redirectUrl);
      return undefined;
    }
    response.header("Content-Type", file.mimeType);
    response.header("Content-Disposition", `inline; filename="${file.fileName}"`);
    return new StreamableFile(file.buffer!);
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
