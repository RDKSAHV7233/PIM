import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { PlanGuard } from "../billing/plan-guard.guard";
import { RequirePlanLimit } from "../billing/require-plan-limit.decorator";
import { CursorPaginationDto } from "../common/pagination/cursor-pagination.dto";
import { CloneMappingTemplateDto } from "./dto/clone-mapping-template.dto";
import { CreateExportJobAliasDto } from "./dto/create-export-job-alias.dto";
import { CreateExportJobDto } from "./dto/create-export-job.dto";
import { CreateMappingTemplateDto } from "./dto/create-mapping-template.dto";
import { SimulateMarketplaceDto } from "./dto/simulate-marketplace.dto";
import { UpdateMappingTemplateDto } from "./dto/update-mapping-template.dto";
import { MarketplaceService } from "./marketplace.service";

@Controller("marketplace")
@ApiTags("Marketplace")
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

  @Get("templates/:id")
  getTemplate(@Param("id") templateId: string) {
    return this.marketplaceService.getTemplate(templateId);
  }

  @Patch("templates/:id")
  updateTemplate(@Param("id") templateId: string, @Body() dto: UpdateMappingTemplateDto) {
    return this.marketplaceService.updateTemplate(templateId, dto);
  }

  @Delete("templates/:id")
  deleteTemplate(@Param("id") templateId: string) {
    return this.marketplaceService.deleteTemplate(templateId);
  }

  @Post("templates/:id/clone")
  cloneTemplate(@Param("id") templateId: string, @Body() dto: CloneMappingTemplateDto) {
    return this.marketplaceService.cloneTemplate(templateId, dto);
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
  @UseGuards(PlanGuard)
  @RequirePlanLimit("submissions")
  @ApiOperation({ summary: "Create marketplace export job" })
  @ApiResponse({ status: 201, description: "Export job queued" })
  @ApiResponse({ status: 402, description: "Plan limit exceeded" })
  createExportJob(@Param("id") productId: string, @Body() dto: CreateExportJobDto) {
    return this.marketplaceService.createExportJob(productId, dto);
  }

  @Get("export-jobs")
  @ApiOperation({ summary: "List export jobs" })
  @ApiResponse({ status: 200, description: "Export jobs fetched" })
  listExportJobs(@Query("productId") productId?: string, @Query() pagination?: CursorPaginationDto) {
    return this.marketplaceService.listExportJobs(productId, pagination);
  }

  @Post("export-job")
  @UseGuards(PlanGuard)
  @RequirePlanLimit("submissions")
  @ApiOperation({ summary: "Create export job (alias endpoint)" })
  @ApiResponse({ status: 201, description: "Export job queued" })
  @ApiResponse({ status: 402, description: "Plan limit exceeded" })
  createExportJobAlias(@Body() dto: CreateExportJobAliasDto) {
    return this.marketplaceService.createExportJob(dto.productId, dto);
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
