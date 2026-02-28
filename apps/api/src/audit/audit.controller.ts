import { Controller, Get, Query } from "@nestjs/common";
import { AuditService } from "./audit.service";

@Controller("audit")
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get("logs")
  listLogs(@Query("limit") limit?: string, @Query("actorId") actorId?: string) {
    const parsedLimit = limit ? Number(limit) : 50;
    return this.auditService.list(parsedLimit, actorId);
  }
}
