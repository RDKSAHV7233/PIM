import { Body, Controller, Get, Param, Post, Query } from "@nestjs/common";
import { CreateExportJobDto } from "./dto/create-export-job.dto";
import { CreateMappingTemplateDto } from "./dto/create-mapping-template.dto";
import { SimulateMarketplaceDto } from "./dto/simulate-marketplace.dto";
import { MarketplaceService } from "./marketplace.service";

@Controller("marketplace")
export class MarketplaceController {
  constructor(private readonly marketplaceService: MarketplaceService) {}

  @Get("channels")
  listChannels() {
    return this.marketplaceService.listChannels();
  }

  @Get("channels/:channel/mapping")
  getChannelMapping(
    @Param("channel") channel: string,
    @Query("categoryId") categoryId?: string,
    @Query("templateId") templateId?: string,
  ) {
    return this.marketplaceService.getChannelMapping(channel, categoryId, templateId);
  }

  @Get("categories/:id/templates")
  listTemplates(@Param("id") categoryId: string, @Query("channel") channel?: string) {
    return this.marketplaceService.listTemplates(categoryId, channel);
  }

  @Post("categories/:id/templates")
  createTemplate(@Param("id") categoryId: string, @Body() dto: CreateMappingTemplateDto) {
    return this.marketplaceService.createTemplate(categoryId, dto);
  }

  @Get("products/:id/simulate")
  simulateProductQuery(
    @Param("id") productId: string,
    @Query("channel") channel = "amazon",
    @Query("templateId") templateId?: string,
  ) {
    return this.marketplaceService.simulateProduct(productId, channel, templateId);
  }

  @Post("products/:id/simulate")
  simulateProductBody(@Param("id") productId: string, @Body() dto: SimulateMarketplaceDto) {
    return this.marketplaceService.simulateProduct(productId, dto.channel, dto.templateId);
  }

  @Post("products/:id/export-jobs")
  createExportJob(@Param("id") productId: string, @Body() dto: CreateExportJobDto) {
    return this.marketplaceService.createExportJob(productId, dto);
  }

  @Get("export-jobs")
  listExportJobs(@Query("productId") productId?: string) {
    return this.marketplaceService.listExportJobs(productId);
  }

  @Get("export-jobs/:id")
  getExportJob(@Param("id") jobId: string) {
    return this.marketplaceService.getExportJob(jobId);
  }

  @Post("export-jobs/:id/process")
  processExportJob(@Param("id") jobId: string) {
    return this.marketplaceService.processExportJob(jobId);
  }

  @Post("export-jobs/:id/requeue")
  requeueExportJob(@Param("id") jobId: string) {
    return this.marketplaceService.requeueExportJob(jobId);
  }
}
