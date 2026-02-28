import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { CreateMediaAssetDto } from "./dto/create-media-asset.dto";
import { MediaService } from "./media.service";

@Controller("media")
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  @Post("assets")
  createAsset(@Body() dto: CreateMediaAssetDto) {
    return this.mediaService.createAsset(dto);
  }

  @Get("assets")
  listAssets(@Query("productId") productId?: string) {
    return this.mediaService.listAssets(productId);
  }

  @Get("assets/:id")
  getAsset(@Param("id") id: string) {
    return this.mediaService.getAsset(id);
  }

  @Get("assets/:id/validation")
  validateAsset(@Param("id") id: string, @Query("channel") channel = "amazon") {
    return this.mediaService.validateAsset(id, channel);
  }
}
