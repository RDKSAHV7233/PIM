import { Body, Controller, Get, Logger, Param, Patch, Post, Query, Req, Res, StreamableFile, UnauthorizedException, UseGuards } from "@nestjs/common";
import { resolveServeHeaders } from "./media-content-safety";
import { MediaTokenError, isMediaSigningConfigured, verifyMediaToken } from "./media-url-token";
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
  private readonly logger = new Logger(MediaController.name);
  private warnedUnsigned = false;

  constructor(private readonly mediaService: MediaService) {}

  /** One loud line per process while the public route is still unsigned, so the rollout state is visible and cannot be forgotten. */
  private warnUnsignedOnce(): void {
    if (!this.warnedUnsigned) {
      this.warnedUnsigned = true;
      this.logger.warn(
        "MEDIA_URL_SIGNING_KEY is not configured: public media URLs are served UNSIGNED and resolve only the default tenant once row level security is enforced. Provision the key before the database role cutover.",
      );
    }
  }

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
  async getAssetFile(@Param("id") id: string, @Query("t") token: string | undefined, @Res({ passthrough: true }) response: Response) {
    // SEC-DB-RLS-001 D1: once MEDIA_URL_SIGNING_KEY is configured the route REQUIRES a valid, unexpired token bound to this asset and
    // reads the tenant from it; the token is verified BEFORE any database access, every failure gets the same answer, and there is no
    // unsigned tenant parameter. Until the key is configured the route keeps its previous unsigned behaviour (rollout compatibility;
    // it can only resolve the default tenant under row level security, so setting the key is a prerequisite of the role cutover).
    let tenantKey: string | undefined;
    if (isMediaSigningConfigured()) {
      try {
        tenantKey = verifyMediaToken(token, { assetId: id }).tenantKey;
      } catch (error) {
        if (error instanceof MediaTokenError) {
          this.logger.warn(`Public media request refused (${error.reason}).`);
          throw new UnauthorizedException({ error: "MEDIA_TOKEN_INVALID" });
        }
        throw error;
      }
    } else {
      this.warnUnsignedOnce();
    }
    const file = await this.mediaService.getAssetFile(id, tenantKey);
    if (file.redirectUrl) {
      response.redirect(302, file.redirectUrl);
      return undefined;
    }
    // Safe delivery (prod-cert DEF-PC-002/014): only allowed raster images are served inline;
    // legacy non-image rows become a download; the filename can no longer break the header.
    const serve = resolveServeHeaders(file.mimeType, file.fileName);
    response.header("Content-Type", serve.contentType);
    response.header("Content-Disposition", serve.contentDisposition);
    response.header("Content-Security-Policy", "default-src 'none'; sandbox");
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
