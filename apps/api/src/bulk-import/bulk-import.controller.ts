import { Body, Controller, Get, Header, Param, Post, Query, Res } from "@nestjs/common";
import { FastifyReply } from "fastify";
import { BulkImportService } from "./bulk-import.service";
import { CreateBulkImportJobDto } from "./dto/create-bulk-import-job.dto";
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

  @Post("mapping-suggestions")
  suggestMapping(@Body() dto: SuggestMappingDto) {
    return this.bulkImportService.suggestMapping(dto.headers);
  }

  @Get("jobs")
  listJobs(@Query("status") status?: string) {
    return this.bulkImportService.listJobs(status);
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
  ) {
    return this.bulkImportService.listJobRows(jobId, status, limit ? Number(limit) : undefined);
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
