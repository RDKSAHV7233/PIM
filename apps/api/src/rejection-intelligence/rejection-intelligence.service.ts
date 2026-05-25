import { Injectable, NotFoundException } from "@nestjs/common";
import { RuleSeverity, ValidationIssueStatus } from "@prisma/client";
import { AccessPolicyService, type PolicyActor } from "../common/access-policy/access-policy.service";
import { parseMarketplaceChannel, type MarketplaceChannel } from "../marketplace/marketplace-channels";
import { PrismaService } from "../prisma/prisma.service";

type Channel = MarketplaceChannel;

@Injectable()
export class RejectionIntelligenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessPolicyService: AccessPolicyService,
  ) {}

  async scoreProduct(productId: string, channelInput: string, actor: PolicyActor) {
    const channel = this.parseChannel(channelInput);
    const product = await this.prisma.tenant().product.findUnique({
      where: { id: productId },
      include: {
        validationIssues: {
          where: { status: ValidationIssueStatus.open },
          take: 100,
        },
      },
    });
    if (!product) {
      throw new NotFoundException("Product not found");
    }
    await this.accessPolicyService.assertProductAccess(
      actor,
      "view",
      {
        id: product.id,
        categoryId: product.categoryId,
        brand: product.brand,
        vendorScopeKey: product.vendorScopeKey,
      },
      "RejectionIntelligenceScore",
    );

    const mediaRows = await this.prisma.tenant().mediaAsset.findMany({
      where: {
        productId,
      },
      orderBy: {
        createdAt: "desc",
      },
      take: 100, // defensive cap — images per product
      select: {
        id: true,
        width: true,
        height: true,
        mimeType: true,
      },
    });

    const complianceErrors = product.validationIssues.filter(
      (issue) => issue.severity === RuleSeverity.error,
    ).length;
    const complianceWarnings = product.validationIssues.filter(
      (issue) => issue.severity === RuleSeverity.warning,
    ).length;

    const missingCoreFields = [
      !product.title?.trim() ? "title" : null,
      !product.brand?.trim() ? "brand" : null,
      !product.description?.trim() ? "description" : null,
      !product.hsnCode?.trim() ? "hsnCode" : null,
      product.gstRate === null || product.gstRate === undefined ? "gstRate" : null,
    ].filter(Boolean) as string[];

    const mediaIssues: string[] = [];
    if (mediaRows.length === 0) {
      mediaIssues.push("No product media uploaded.");
    } else {
      const validImage = mediaRows.find((row) => row.mimeType.startsWith("image/"));
      if (!validImage) {
        mediaIssues.push("Uploaded media MIME types are not images.");
      } else if (!validImage.width || !validImage.height) {
        mediaIssues.push("Primary image is missing width/height metadata.");
      }
    }

    const channelPenalty = channel === "amazon" ? 1.1 : channel === "flipkart" ? 1.0 : 0.9;
    const baseScore =
      missingCoreFields.length * 15 + complianceErrors * 22 + complianceWarnings * 8 + mediaIssues.length * 18;
    const riskScore = Math.min(100, Math.round(baseScore * channelPenalty));
    const riskBand = riskScore >= 60 ? "high" : riskScore >= 30 ? "medium" : "low";

    const suggestions = [
      ...missingCoreFields.map((field) => ({
        field,
        suggestion: `Fill ${field} before publishing.`,
      })),
      ...mediaIssues.map((issue) => ({
        field: "media",
        suggestion: issue,
      })),
      ...product.validationIssues.slice(0, 5).map((issue) => ({
        field: issue.fieldPath ?? issue.ruleCode,
        suggestion: issue.message,
      })),
    ];

    return {
      productId,
      channel,
      riskScore,
      riskBand,
      summary: {
        missingCoreFields,
        complianceErrors,
        complianceWarnings,
        mediaIssueCount: mediaIssues.length,
      },
      mediaIssues,
      suggestions,
      topPatterns: this.topPatterns(missingCoreFields, complianceErrors, mediaIssues.length),
    };
  }

  private topPatterns(missingCoreFields: string[], complianceErrors: number, mediaIssueCount: number) {
    const patterns: string[] = [];
    if (missingCoreFields.length > 0) {
      patterns.push("Missing core catalog fields");
    }
    if (complianceErrors > 0) {
      patterns.push("Open compliance errors");
    }
    if (mediaIssueCount > 0) {
      patterns.push("Media quality/availability gaps");
    }
    if (patterns.length === 0) {
      patterns.push("No dominant rejection pattern detected");
    }
    return patterns;
  }

  private parseChannel(value: string): Channel {
    return parseMarketplaceChannel(value);
  }
}
