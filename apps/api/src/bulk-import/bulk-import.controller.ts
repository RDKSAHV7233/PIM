import { Body, Controller, Get, Header, Param, Post, Query, Req, Res } from "@nestjs/common";
import { FastifyReply } from "fastify";
import { CursorPaginationDto } from "../common/pagination/cursor-pagination.dto";
import { ApiClientScopes, DisallowApiClient } from "../common/rbac/api-client-policy.decorator";
import { AuthenticatedReadRoute } from "../common/rbac/read-access-policy.decorator";
import { AppRole, Roles } from "../common/rbac/roles";
import { BulkImportService } from "./bulk-import.service";
import { CreateBulkImportJobDto } from "./dto/create-bulk-import-job.dto";
import { CreateBulkImportTemplateDto } from "./dto/create-bulk-import-template.dto";
import { ProcessBulkImportJobDto } from "./dto/process-bulk-import-job.dto";
import { RepairBulkImportRowDto } from "./dto/repair-bulk-import-row.dto";
import { RequeueDlqDto } from "./dto/requeue-dlq.dto";
import { SuggestMappingDto } from "./dto/suggest-mapping.dto";

@DisallowApiClient()
@AuthenticatedReadRoute({ classification: "admin_editor", responseHandling: "none", apiClientPolicy: "denied_human_only" })
@Controller("bulk-import")
export class BulkImportController {
  constructor(private readonly bulkImportService: BulkImportService) {}

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
    @Res({ passthrough: true }) response: FastifyReply,
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
}
