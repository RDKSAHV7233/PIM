import { Body, Controller, Get, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { Roles } from "../common/rbac/roles";
import { ComplianceService } from "./compliance.service";
import { IssueInboxQueryDto } from "./dto/issue-inbox-query.dto";
import { ResolveIssueInboxDto } from "./dto/resolve-issue-inbox.dto";

@Controller("issues")
@ApiTags("Compliance")
export class IssuesController {
  constructor(private readonly complianceService: ComplianceService) {}

  @Get("inbox")
  @ApiOperation({ summary: "List tenant-wide open compliance issues" })
  @ApiResponse({ status: 200, description: "Issue inbox fetched" })
  listInbox(@Query() query: IssueInboxQueryDto) {
    return this.complianceService.listIssueInbox(query);
  }

  @Post("inbox/resolve")
  @Roles("admin", "editor")
  @ApiOperation({ summary: "Resolve warning-level issues in bulk" })
  @ApiResponse({ status: 201, description: "Issue resolution applied" })
  resolveWarnings(@Body() dto: ResolveIssueInboxDto) {
    return this.complianceService.resolveIssueInboxWarnings(dto.issueIds);
  }
}
