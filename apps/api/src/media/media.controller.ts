import { Body, Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { PlanGuard } from "../billing/plan-guard.guard";
import { RequirePlanLimit } from "../billing/require-plan-limit.decorator";
import { CursorPaginationDto } from "../common/pagination/cursor-pagination.dto";
import { DEFAULT_MARKETPLACE_CHANNEL } from "../marketplace/marketplace-channels";
import { BulkMediaAssociationDto } from "./dto/bulk-media-association.dto";
import { CreateMediaAssetDto } from "./dto/create-media-asset.dto";
import { MediaService } from "./media.service";

@Controller("media")
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post("assets")
  @UseGuards(PlanGuard)
  @RequirePlanLimit("storage_gb")
  createAsset(@Body() dto: CreateMediaAssetDto) {
    return this.mediaService.createAsset(dto);
  }

  @Get("assets")
  listAssets(
    @Query("productId") productId?: string,
    @Query("variantId") variantId?: string,
    @Query() pagination?: CursorPaginationDto,
  ) {
    return this.mediaService.listAssets(productId, variantId, pagination);
  }

  @Get("assets/:id")
  getAsset(@Param("id") id: string) {
    return this.mediaService.getAsset(id);
  }

  @Get("assets/:id/validation")
  validateAsset(@Param("id") id: string, @Query("channel") channel = DEFAULT_MARKETPLACE_CHANNEL) {
    return this.mediaService.validateAsset(id, channel);
  }

  @Post("bulk-associations")
  bulkAssociate(@Body() dto: BulkMediaAssociationDto) {
    return this.mediaService.bulkAssociate(dto);
  }
}
