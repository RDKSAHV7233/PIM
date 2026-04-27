import { Controller, Get, Header, Query, Res } from "@nestjs/common";
import { FastifyReply } from "fastify";
import { CursorPaginationDto } from "../common/pagination/cursor-pagination.dto";
import { DisallowApiClient } from "../common/rbac/api-client-policy.decorator";
import { AuthenticatedReadRoute } from "../common/rbac/read-access-policy.decorator";
import { Roles } from "../common/rbac/roles";
import { AuditService } from "./audit.service";
import { ListAuditEventsDto } from "./dto/list-audit-events.dto";

@DisallowApiClient()
@AuthenticatedReadRoute({ classification: "admin_only", responseHandling: "none", apiClientPolicy: "denied_human_only" })
@Controller("audit")
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get("logs")
  @Roles("admin")
  listLogs(@Query("limit") limit?: string, @Query("actorId") actorId?: string, @Query() pagination?: CursorPaginationDto) {
    const parsedLimit = limit ? Number(limit) : 50;
    return this.auditService.list(parsedLimit, actorId, pagination);
  }

  @Get("events")
  @Roles("admin")
  listEvents(@Query() query: ListAuditEventsDto) {
    return this.auditService.listEvents(query);
  }

  @Get("events/export")
  @Roles("admin")
  @Header("Content-Type", "text/csv; charset=utf-8")
  async exportEvents(@Query() query: ListAuditEventsDto, @Res({ passthrough: true }) response: FastifyReply) {
    const stamp = new Date().toISOString().slice(0, 10);
    response.header("Content-Disposition", `attachment; filename="vexa-pim-audit-events-${stamp}.csv"`);
    return this.auditService.exportEventsCsv(query);
  }
}
