import { BadRequestException, Body, Controller, Get, Header, Param, Post, Query, Req, Res, UseInterceptors, UploadedFile } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { CursorPaginationDto } from "../common/pagination/cursor-pagination.dto";
import { ApiClientScopes, DisallowApiClient } from "../common/rbac/api-client-policy.decorator";
import { AuthenticatedReadRoute } from "../common/rbac/read-access-policy.decorator";
import { AppRole, Roles } from "../common/rbac/roles";
import { BulkImportService } from "./bulk-import.service";
import { BulkImportRunService } from "./bulk-import-run.service";
import { CreateBulkImportJobDto } from "./dto/create-bulk-import-job.dto";
import { CreateBulkImportRunDto } from "./dto/create-bulk-import-run.dto";
import { CreateBulkImportTemplateDto } from "./dto/create-bulk-import-template.dto";
import { ImportValidateDto } from "./dto/import-validate.dto";
import { ProcessBulkImportJobDto } from "./dto/process-bulk-import-job.dto";
import { RepairBulkImportRowDto } from "./dto/repair-bulk-import-row.dto";
import { RequeueDlqDto } from "./dto/requeue-dlq.dto";
import { SuggestMappingDto } from "./dto/suggest-mapping.dto";

@DisallowApiClient()
@AuthenticatedReadRoute({ classification: "admin_editor", responseHandling: "none", apiClientPolicy: "denied_human_only" })
@Controller("bulk-import")
export class BulkImportController {
  constructor(
    private readonly bulkImportService: BulkImportService,
    private readonly bulkImportRunService: BulkImportRunService,
  ) {}

  @Roles("admin", "editor")
  @Post("validate")
  validateJobInput(
    @Body() dto: CreateBulkImportJobDto,
    @Req() request: { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.bulkImportService.validateJobInput(dto, {
      actorId: request.pimUserId,
      actorRole: request.pimRole,
      tenantId: request.pimTenant,
    });
  }

  @Roles("admin", "editor")
  @Post("jobs")
  createJob(
    @Body() dto: CreateBulkImportJobDto,
    @Req() request: { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.bulkImportService.createJob(dto, {
      actorId: request.pimUserId,
      actorRole: request.pimRole,
      tenantId: request.pimTenant,
    });
  }

  @Roles("admin", "editor")
  @Post("validate/preflight")
  validateImport(
    @Body() dto: ImportValidateDto,
    @Req() request: { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.bulkImportService.validateImport({
      categoryId: dto.categoryId,
      fileName: dto.fileName,
      fileSize: dto.fileSize,
      mimeType: dto.mimeType,
    });
  }

  @Roles("admin", "editor")
  @Post("templates")
  createTemplate(
    @Body() dto: CreateBulkImportTemplateDto,
    @Req() request: { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.bulkImportService.createTemplate(dto, {
      actorId: request.pimUserId,
      actorRole: request.pimRole,
      tenantId: request.pimTenant,
    });
  }

  @Roles("admin", "editor")
  @Get("templates")
  @AuthenticatedReadRoute({ classification: "admin_editor", responseHandling: "none", apiClientPolicy: "allowed_with_api_scope" })
  @ApiClientScopes("bulk_import.read")
  listTemplates(
    @Query("tenantKey") tenantKey?: string,
    @Query("categoryId") categoryId?: string,
    @Query() pagination?: CursorPaginationDto,
    @Req() request?: { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.bulkImportService.listTemplates(tenantKey, categoryId, pagination, {
      actorId: request?.pimUserId,
      actorRole: request?.pimRole,
      tenantId: request?.pimTenant,
    });
  }

  @Roles("admin", "editor")
  @Get("templates/:id")
  @AuthenticatedReadRoute({ classification: "admin_editor", responseHandling: "none", apiClientPolicy: "allowed_with_api_scope" })
  @ApiClientScopes("bulk_import.read")
  getTemplate(
    @Param("id") templateId: string,
    @Query("tenantKey") tenantKey?: string,
    @Req() request?: { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.bulkImportService.getTemplate(templateId, tenantKey, {
      actorId: request?.pimUserId,
      actorRole: request?.pimRole,
      tenantId: request?.pimTenant,
    });
  }

  @Roles("admin", "editor")
  @Post("mapping-suggestions")
  suggestMapping(@Body() dto: SuggestMappingDto) {
    return this.bulkImportService.suggestMapping(dto.headers);
  }

  @Roles("admin", "editor")
  @Get("jobs")
  @AuthenticatedReadRoute({ classification: "admin_editor", responseHandling: "none", apiClientPolicy: "allowed_with_api_scope" })
  @ApiClientScopes("bulk_import.read")
  listJobs(
    @Query("status") status?: string,
    @Query() pagination?: CursorPaginationDto,
    @Req() request?: { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.bulkImportService.listJobs(status, pagination, {
      actorId: request?.pimUserId,
      actorRole: request?.pimRole,
      tenantId: request?.pimTenant,
    });
  }

  @Roles("admin", "editor")
  @Get("jobs/:id")
  @AuthenticatedReadRoute({ classification: "admin_editor", responseHandling: "none", apiClientPolicy: "allowed_with_api_scope" })
  @ApiClientScopes("bulk_import.read")
  getJob(
    @Param("id") jobId: string,
    @Req() request?: { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.bulkImportService.getJob(jobId, {
      actorId: request?.pimUserId,
      actorRole: request?.pimRole,
      tenantId: request?.pimTenant,
    });
  }

  @Roles("admin", "editor")
  @Get("jobs/:id/rows")
  @AuthenticatedReadRoute({ classification: "admin_editor", responseHandling: "none", apiClientPolicy: "allowed_with_api_scope" })
  @ApiClientScopes("bulk_import.read")
  listRows(
    @Param("id") jobId: string,
    @Query("status") status?: string,
    @Query("limit") limit?: string,
    @Query() pagination?: CursorPaginationDto,
    @Req() request?: { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.bulkImportService.listJobRows(jobId, status, limit ? Number(limit) : undefined, pagination, {
      actorId: request?.pimUserId,
      actorRole: request?.pimRole,
      tenantId: request?.pimTenant,
    });
  }

  @Roles("admin", "editor")
  @Get("jobs/:id/error-report")
  @AuthenticatedReadRoute({ classification: "admin_editor", responseHandling: "none", apiClientPolicy: "allowed_with_api_scope" })
  @ApiClientScopes("bulk_import.read")
  @Header("Content-Type", "text/csv; charset=utf-8")
  async getErrorReport(
    @Param("id") jobId: string,
    @Res({ passthrough: true }) response: Response,
    @Req() request?: { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    response.header(
      "Content-Disposition",
      `attachment; filename="bulk-import-${jobId}-errors.csv"`,
    );
    return this.bulkImportService.buildErrorReportCsv(jobId, {
      actorId: request?.pimUserId,
      actorRole: request?.pimRole,
      tenantId: request?.pimTenant,
    });
  }

  @Roles("admin", "editor")
  @Post("jobs/:id/validate")
  validateJob(
    @Param("id") jobId: string,
    @Req() request: { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.bulkImportService.preflightValidateJob(jobId, {
      actorId: request.pimUserId,
      actorRole: request.pimRole,
      tenantId: request.pimTenant,
    });
  }

  @Roles("admin", "editor")
  @Post("jobs/:id/process")
  processJob(
    @Param("id") jobId: string,
    @Body() dto: ProcessBulkImportJobDto,
    @Req() request?: { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.bulkImportService.processJob(jobId, dto.chunkSize, {
      actorId: request?.pimUserId,
      actorRole: request?.pimRole,
      tenantId: request?.pimTenant,
    });
  }

  @Roles("admin", "editor")
  @Post("jobs/:id/requeue-dlq")
  requeueDlq(
    @Param("id") jobId: string,
    @Body() dto: RequeueDlqDto,
    @Req() request?: { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.bulkImportService.requeueDlq(jobId, dto.limit, {
      actorId: request?.pimUserId,
      actorRole: request?.pimRole,
      tenantId: request?.pimTenant,
    });
  }

  @Roles("admin", "editor")
  @Post("jobs/:id/rows/:rowId/process")
  processRow(
    @Param("id") jobId: string,
    @Param("rowId") rowId: string,
    @Req() request?: { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.bulkImportService.processRowById(jobId, rowId, {
      actorId: request?.pimUserId,
      actorRole: request?.pimRole,
      tenantId: request?.pimTenant,
    });
  }

  @Roles("admin", "editor")
  @Post("jobs/:id/rows/:rowId/repair")
  repairRow(
    @Param("id") jobId: string,
    @Param("rowId") rowId: string,
    @Body() dto: RepairBulkImportRowDto,
    @Req() request?: { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.bulkImportService.repairRow(jobId, rowId, dto, {
      actorId: request?.pimUserId,
      actorRole: request?.pimRole,
      tenantId: request?.pimTenant,
    });
  }

  // ── Run endpoints (Large Import Mode MVP) ────────────────────────────────────

  @Roles("admin", "editor")
  @Post("runs/upload")
  @UseInterceptors(FileInterceptor("sourceFile", { limits: { fileSize: 32 * 1024 * 1024 } }))
  async uploadRun(
    @Body() dto: CreateBulkImportRunDto,
    @UploadedFile() file: { buffer: Buffer; originalname: string; size: number },
    @Req() request: { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    if (!file) {
      throw new BadRequestException("sourceFile is required");
    }
    return this.bulkImportRunService.uploadRun(
      dto,
      file.buffer,
      file.originalname,
      file.size,
      {
        actorId: request.pimUserId,
        actorRole: request.pimRole,
        tenantId: request.pimTenant,
      },
    );
  }

  @Roles("admin", "editor")
  @Get("runs")
  @AuthenticatedReadRoute({ classification: "admin_editor", responseHandling: "none", apiClientPolicy: "allowed_with_api_scope" })
  @ApiClientScopes("bulk_import.read")
  listRuns(
    @Query("status") status?: string,
    @Query() pagination?: CursorPaginationDto,
    @Req() request?: { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.bulkImportRunService.listRuns(status, pagination, {
      actorId: request?.pimUserId,
      actorRole: request?.pimRole,
      tenantId: request?.pimTenant,
    });
  }

  @Roles("admin", "editor")
  @Get("runs/:id")
  @AuthenticatedReadRoute({ classification: "admin_editor", responseHandling: "none", apiClientPolicy: "allowed_with_api_scope" })
  @ApiClientScopes("bulk_import.read")
  getRun(
    @Param("id") runId: string,
    @Req() request?: { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.bulkImportRunService.getRun(runId, {
      actorId: request?.pimUserId,
      actorRole: request?.pimRole,
      tenantId: request?.pimTenant,
    });
  }

  @Roles("admin", "editor")
  @Post("runs/:id/validate")
  validateRun(
    @Param("id") runId: string,
    @Req() request: { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.bulkImportRunService.validateRun(runId, {
      actorId: request.pimUserId,
      actorRole: request.pimRole,
      tenantId: request.pimTenant,
    });
  }

  @Roles("admin", "editor")
  @Post("runs/:id/start")
  startRun(
    @Param("id") runId: string,
    @Req() request: { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.bulkImportRunService.startRun(runId, {
      actorId: request.pimUserId,
      actorRole: request.pimRole,
      tenantId: request.pimTenant,
    });
  }

  @Roles("admin", "editor")
  @Get("runs/:id/rows")
  @AuthenticatedReadRoute({ classification: "admin_editor", responseHandling: "none", apiClientPolicy: "allowed_with_api_scope" })
  @ApiClientScopes("bulk_import.read")
  listRunRows(
    @Param("id") runId: string,
    @Query("status") status?: string,
    @Query() pagination?: CursorPaginationDto,
    @Req() request?: { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.bulkImportRunService.listRunRows(runId, status, pagination, {
      actorId: request?.pimUserId,
      actorRole: request?.pimRole,
      tenantId: request?.pimTenant,
    });
  }

  @Roles("admin", "editor")
  @Get("runs/:id/error-report")
  @AuthenticatedReadRoute({ classification: "admin_editor", responseHandling: "none", apiClientPolicy: "allowed_with_api_scope" })
  @ApiClientScopes("bulk_import.read")
  @Header("Content-Type", "text/csv; charset=utf-8")
  async getRunErrorReport(
    @Param("id") runId: string,
    @Res({ passthrough: true }) response: Response,
    @Req() request?: { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    response.header("Content-Disposition", `attachment; filename="bulk-import-run-${runId}-errors.csv"`);
    return this.bulkImportRunService.buildRunErrorReportCsv(runId, {
      actorId: request?.pimUserId,
      actorRole: request?.pimRole,
      tenantId: request?.pimTenant,
    });
  }
}
