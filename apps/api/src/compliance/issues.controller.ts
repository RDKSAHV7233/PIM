import { Body, Controller, Get, Post, Query, Req } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import type { PolicyActor } from "../common/access-policy/access-policy.service";
import { ApiClientScopes, DisallowApiClient } from "../common/rbac/api-client-policy.decorator";
import { ReadAccessPolicy } from "../common/rbac/read-access-policy.decorator";
import { type AppRole, Roles } from "../common/rbac/roles";
import { ComplianceService } from "./compliance.service";
import { IssueInboxQueryDto } from "./dto/issue-inbox-query.dto";
import { ResolveIssueInboxDto } from "./dto/resolve-issue-inbox.dto";

type AuthenticatedRequest = Request & {
  pimUserId?: string;
  pimRole?: AppRole;
  pimTenant?: string;
  pimAuthType?: "user_jwt" | "api_key";
};

@DisallowApiClient()
@Controller("issues")
@ApiTags("Compliance")
export class IssuesController {
  constructor(private readonly complianceService: ComplianceService) {}

  @Get("inbox")
  @ReadAccessPolicy("issue_inbox_scoped")
  @ApiClientScopes("issues.read")
  @ApiOperation({ summary: "List tenant-wide open compliance issues" })
  @ApiResponse({ status: 200, description: "Issue inbox fetched" })
  listInbox(@Query() query: IssueInboxQueryDto, @Req() request: AuthenticatedRequest) {
    return this.complianceService.listIssueInbox(query, this.resolveActor(request));
  }

  @Post("inbox/resolve")
  @Roles("admin", "editor")
  @ApiOperation({ summary: "Resolve warning-level issues in bulk" })
  @ApiResponse({ status: 201, description: "Issue resolution applied" })
  resolveWarnings(@Body() dto: ResolveIssueInboxDto, @Req() request: AuthenticatedRequest) {
    return this.complianceService.resolveIssueInboxWarnings(dto.issueIds, this.resolveActor(request));
  }

  private resolveActor(request: AuthenticatedRequest): PolicyActor {
    return {
      actorId: request.pimUserId,
      actorRole: request.pimRole,
      tenantId: request.pimTenant,
      actorType: request.pimAuthType === "api_key" ? "api_client" : "human",
    };
  }
}
