import { Body, Controller, Get, Header, Param, Post, Query, Res } from "@nestjs/common";
import { FastifyReply } from "fastify";
import { CursorPaginationDto } from "../common/pagination/cursor-pagination.dto";
import { BulkImportService } from "./bulk-import.service";
import { CreateBulkImportJobDto } from "./dto/create-bulk-import-job.dto";
import { CreateBulkImportTemplateDto } from "./dto/create-bulk-import-template.dto";
import { ProcessBulkImportJobDto } from "./dto/process-bulk-import-job.dto";
import { RepairBulkImportRowDto } from "./dto/repair-bulk-import-row.dto";
import { RequeueDlqDto } from "./dto/requeue-dlq.dto";
import { SuggestMappingDto } from "./dto/suggest-mapping.dto";

@Controller("bulk-import")
export class BulkImportController {
  constructor(private readonly bulkImportService: BulkImportService) {}

  @Post("jobs")
  createJob(@Body() dto: CreateBulkImportJobDto) {
    return this.bulkImportService.createJob(dto);
  }

  @Post("templates")
  createTemplate(@Body() dto: CreateBulkImportTemplateDto) {
    return this.bulkImportService.createTemplate(dto);
  }

  @Get("templates")
  listTemplates(
    @Query("tenantKey") tenantKey?: string,
    @Query("categoryId") categoryId?: string,
    @Query() pagination?: CursorPaginationDto,
  ) {
    return this.bulkImportService.listTemplates(tenantKey, categoryId, pagination);
  }

  @Get("templates/:id")
  getTemplate(
    @Param("id") templateId: string,
    @Query("tenantKey") tenantKey?: string,
  ) {
    return this.bulkImportService.getTemplate(templateId, tenantKey);
  }

  @Post("mapping-suggestions")
  suggestMapping(@Body() dto: SuggestMappingDto) {
    return this.bulkImportService.suggestMapping(dto.headers);
  }

  @Get("jobs")
  listJobs(@Query("status") status?: string, @Query() pagination?: CursorPaginationDto) {
    return this.bulkImportService.listJobs(status, pagination);
  }

  @Get("jobs/:id")
  getJob(@Param("id") jobId: string) {
    return this.bulkImportService.getJob(jobId);
  }

  @Get("jobs/:id/rows")
  listRows(
    @Param("id") jobId: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
    @Query() pagination?: CursorPaginationDto,
  ) {
    return this.bulkImportService.listJobRows(jobId, status, limit ? Number(limit) : undefined, pagination);
  }

  @Get("jobs/:id/error-report")
  @Header("Content-Type", "text/csv; charset=utf-8")
  async getErrorReport(@Param("id") jobId: string, @Res({ passthrough: true }) response: FastifyReply) {
    response.header(
      "Content-Disposition",
      `attachment; filename="bulk-import-${jobId}-errors.csv"`,
    );
    return this.bulkImportService.buildErrorReportCsv(jobId);
  }

  @Post("jobs/:id/process")
  processJob(@Param("id") jobId: string, @Body() dto: ProcessBulkImportJobDto) {
    return this.bulkImportService.processJob(jobId, dto.chunkSize);
  }

  @Post("jobs/:id/requeue-dlq")
  requeueDlq(@Param("id") jobId: string, @Body() dto: RequeueDlqDto) {
    return this.bulkImportService.requeueDlq(jobId, dto.limit);
  }

  @Post("jobs/:id/rows/:rowId/process")
  processRow(@Param("id") jobId: string, @Param("rowId") rowId: string) {
    return this.bulkImportService.processRowById(jobId, rowId);
  }

  @Post("jobs/:id/rows/:rowId/repair")
  repairRow(
    @Param("id") jobId: string,
    @Param("rowId") rowId: string,
    @Body() dto: RepairBulkImportRowDto,
  ) {
    return this.bulkImportService.repairRow(jobId, rowId, dto);
  }
}
