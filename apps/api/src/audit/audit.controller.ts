import { Controller, Get, Header, Query, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { IsOptional, IsString, MaxLength } from "class-validator";
import { AccessPolicyService } from "../common/access-policy/access-policy.service";
import { CursorPaginationDto } from "../common/pagination/cursor-pagination.dto";
import { AdminBoundaryAccess } from "../common/rbac/admin-boundary.decorator";
import { DisallowApiClient } from "../common/rbac/api-client-policy.decorator";
import { AuthenticatedReadRoute, ReadAccessPolicy } from "../common/rbac/read-access-policy.decorator";
import { AppRole, Roles } from "../common/rbac/roles";
import { AuditService } from "./audit.service";
import { ListAuditEventsDto } from "./dto/list-audit-events.dto";

class ListAuditLogsDto extends CursorPaginationDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  actorId?: string;
}

@DisallowApiClient()
@AuthenticatedReadRoute({ classification: "admin_only", responseHandling: "none", apiClientPolicy: "denied_human_only" })
@AdminBoundaryAccess({ capability: "manage_security" })
@Controller("audit")
export class AuditController {
  constructor(
    private readonly auditService: AuditService,
    private readonly accessPolicyService: AccessPolicyService,
  ) {}

  private resolveActor(
    request: Request & {
      pimUserId?: string;
      pimRole?: AppRole;
      pimTenant?: string;
      pimAuthType?: "user_jwt" | "api_key";
      pimEffectiveRoles?: string[];
    },
  ) {
    return {
      actorId: request.pimUserId,
      actorRole: request.pimRole,
      tenantId: request.pimTenant,
      actorType: request.pimAuthType === "api_key" ? "api_client" : "human",
      effectiveRoles: request.pimEffectiveRoles,
    } as const;
  }

  @Get("logs")
  @ReadAccessPolicy("audit_logs_governance_redacted")
  @Roles("admin")
  listLogs(@Query() query: ListAuditLogsDto) {
    const parsedLimit = query.limit ? Number(query.limit) : 50;
    return this.auditService.list(parsedLimit, query.actorId, query);
  }

  @Get("events")
  @ReadAccessPolicy("audit_events_governance_redacted")
  @Roles("admin")
  listEvents(@Query() query: ListAuditEventsDto) {
    return this.auditService.listEvents(query);
  }

  @Get("events/export")
  @ReadAccessPolicy("audit_events_governance_redacted")
  @Roles("admin")
  @Header("Content-Type", "text/csv; charset=utf-8")
  async exportEvents(
    @Query() query: ListAuditEventsDto,
    @Req()
    request: Request & {
      pimUserId?: string;
      pimRole?: AppRole;
      pimTenant?: string;
      pimAuthType?: "user_jwt" | "api_key";
      pimEffectiveRoles?: string[];
    },
    @Res({ passthrough: true }) response: Response,
  ) {
    const stamp = new Date().toISOString().slice(0, 10);
    response.header("Content-Disposition", `attachment; filename="vexa-pim-audit-events-${stamp}.csv"`);
    const { items, truncated } = await this.auditService.queryEventsForExport(query);
    const visible = this.accessPolicyService.applyReadResponsePolicy(
      this.resolveActor(request),
      "audit_events_governance_redacted",
      { items, limit: items.length, nextCursor: null },
    );
    return this.auditService.renderEventsCsv(visible.items, { truncated });
  }
}
