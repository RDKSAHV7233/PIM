import { Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { DisallowApiClient } from "../common/rbac/api-client-policy.decorator";
import { CursorPaginationDto } from "../common/pagination/cursor-pagination.dto";
import { AuthenticatedReadRoute } from "../common/rbac/read-access-policy.decorator";
import { Roles } from "../common/rbac/roles";
import { MarketplaceService } from "./marketplace.service";

@DisallowApiClient()
@AuthenticatedReadRoute({ classification: "human_only", responseHandling: "none", apiClientPolicy: "denied_human_only" })
@Controller("submissions")
@Roles("admin", "editor", "publisher", "channel_manager")
@ApiTags("Marketplace")
export class SubmissionsController {
  constructor(private readonly marketplaceService: MarketplaceService) {}

  @Get()
  @ApiOperation({ summary: "List submissions" })
  @ApiResponse({ status: 200, description: "Submissions fetched" })
  listSubmissions(
    @Query("productId") productId?: string,
    @Query("connectorSlug") connectorSlug?: string,
    @Query("installationId") installationId?: string,
    @Query("status") status?: string,
    @Query("minAttempt") minAttempt?: string,
    @Query("pagination") pagination?: string,
    @Query("limit") limit?: string,
    @Query("cursor") cursor?: string,
  ) {
    return this.marketplaceService.listSubmissions(
      {
        productId,
        connectorSlug,
        installationId,
        status,
        minAttempt: minAttempt ? Number(minAttempt) : undefined,
      },
      {
        pagination: pagination === "cursor" ? "cursor" : undefined,
        limit: limit ? Number(limit) : undefined,
        cursor,
      },
    );
  }

  @Get("count")
  @ApiOperation({ summary: "Count submissions" })
  @ApiResponse({ status: 200, description: "Submission count fetched" })
  countSubmissions(
    @Query("productId") productId?: string,
    @Query("connectorSlug") connectorSlug?: string,
    @Query("installationId") installationId?: string,
    @Query("status") status?: string,
    @Query("minAttempt") minAttempt?: string,
  ) {
    return this.marketplaceService.countSubmissions({
      productId,
      connectorSlug,
      installationId,
      status,
      minAttempt: minAttempt ? Number(minAttempt) : undefined,
    });
  }

  @Get("dead-letter")
  @ApiOperation({ summary: "List dead-letter submissions/jobs" })
  @ApiResponse({ status: 200, description: "Dead-letter submissions fetched" })
  listDeadLetterSubmissions(@Query() pagination?: CursorPaginationDto) {
    return this.marketplaceService.listDeadLetterSubmissions(pagination);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get submission detail" })
  @ApiResponse({ status: 200, description: "Submission detail fetched" })
  getSubmission(@Param("id") submissionId: string) {
    return this.marketplaceService.getSubmission(submissionId);
  }

  @Get(":id/issues")
  @ApiOperation({ summary: "List normalized issues for a submission" })
  @ApiResponse({ status: 200, description: "Submission issues fetched" })
  getSubmissionIssues(@Param("id") submissionId: string) {
    return this.marketplaceService.getSubmissionIssues(submissionId);
  }

  @Post(":id/sync")
  @Roles("admin", "editor")
  @ApiOperation({ summary: "Sync a submission status from the provider" })
  @ApiResponse({ status: 201, description: "Submission status synced" })
  syncSubmission(@Param("id") submissionId: string) {
    return this.marketplaceService.syncSubmissionStatus(submissionId);
  }

  @Post(":id/retry")
  @Roles("admin", "editor")
  @ApiOperation({ summary: "Retry submission by requeuing underlying export job" })
  @ApiResponse({ status: 201, description: "Submission retry queued" })
  retrySubmission(@Param("id") submissionId: string) {
    return this.marketplaceService.retrySubmission(submissionId);
  }
}
