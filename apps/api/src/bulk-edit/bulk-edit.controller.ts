import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import { CursorPaginationDto } from "../common/pagination/cursor-pagination.dto";
import { DisallowApiClient } from "../common/rbac/api-client-policy.decorator";
import { AuthenticatedReadRoute } from "../common/rbac/read-access-policy.decorator";
import { AppRole, Roles } from "../common/rbac/roles";
import { BulkEditApplyDto } from "./dto/bulk-edit-apply.dto";
import { BulkEditPreviewDto } from "./dto/bulk-edit-preview.dto";
import { BulkEditService } from "./bulk-edit.service";

@DisallowApiClient()
@AuthenticatedReadRoute({ classification: "admin_editor", responseHandling: "none", apiClientPolicy: "denied_human_only" })
@Controller("bulk-edit")
export class BulkEditController {
  constructor(private readonly bulkEditService: BulkEditService) {}

  @Roles("admin", "editor")
  @Post("preview")
  preview(
    @Body() dto: BulkEditPreviewDto,
    @Req() request: { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.bulkEditService.preview(dto.scope, dto.updates, {
      actorId: request.pimUserId,
      actorRole: request.pimRole,
      tenantId: request.pimTenant,
    });
  }

  @Roles("admin", "editor")
  @Post("apply")
  apply(
    @Body() dto: BulkEditApplyDto,
    @Req() request: { pimUserId?: string; pimRole?: AppRole; pimTenant?: string },
  ) {
    return this.bulkEditService.apply(dto.scope, dto.updates, {
      actorId: request.pimUserId,
      actorRole: request.pimRole,
      tenantId: request.pimTenant,
    });
  }

  @Roles("admin", "editor")
  @Get("operations")
  listOperations(@Query("limit") limit?: string, @Query() pagination?: CursorPaginationDto) {
    return this.bulkEditService.listOperations(limit ? Number(limit) : undefined, pagination);
  }

  @Roles("admin", "editor")
  @Get("operations/:id")
  getOperation(@Param("id") operationId: string) {
    return this.bulkEditService.getOperation(operationId);
  }
}
