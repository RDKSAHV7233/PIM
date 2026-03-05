import { Controller, Get, Param, Post, Query } from "@nestjs/common";
import { ApiOperation, ApiResponse, ApiTags } from "@nestjs/swagger";
import { CursorPaginationDto } from "../common/pagination/cursor-pagination.dto";
import { MarketplaceService } from "./marketplace.service";

@Controller("submissions")
@ApiTags("Marketplace")
export class SubmissionsController {
  constructor(private readonly marketplaceService: MarketplaceService) {}

  @Get()
  @ApiOperation({ summary: "List submissions" })
  @ApiResponse({ status: 200, description: "Submissions fetched" })
  listSubmissions(
    @Query("productId") productId?: string,
    @Query("connectorSlug") connectorSlug?: string,
    @Query("status") status?: string,
    @Query("minAttempt") minAttempt?: string,
    @Query() pagination?: CursorPaginationDto,
  ) {
    return this.marketplaceService.listSubmissions(
      {
        productId,
        connectorSlug,
        status,
        minAttempt: minAttempt ? Number(minAttempt) : undefined,
      },
      pagination,
    );
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

  @Post(":id/retry")
  @ApiOperation({ summary: "Retry submission by requeuing underlying export job" })
  @ApiResponse({ status: 201, description: "Submission retry queued" })
  retrySubmission(@Param("id") submissionId: string) {
    return this.marketplaceService.retrySubmission(submissionId);
  }
}
