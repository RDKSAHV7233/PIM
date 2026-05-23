import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, RecordStatus, RuleSeverity, RuleType, ValidationIssueStatus } from "@prisma/client";
import { AccessPolicyService, type PolicyActor } from "../common/access-policy/access-policy.service";
import { CacheService } from "../common/cache/cache.service";
import {
  resolveCursorLimit,
} from "../common/pagination/cursor-pagination";
import { getTenantKeyFromContext } from "../common/tenant/tenant-context";
import { normalizeTenantKey } from "../common/tenant/tenant.constants";
import { PrismaService } from "../prisma/prisma.service";
import { CreateComplianceRuleDto } from "./dto/create-compliance-rule.dto";
import { IssueInboxQueryDto } from "./dto/issue-inbox-query.dto";
import { UpdateComplianceRuleDto } from "./dto/update-compliance-rule.dto";

type IssueDraft = {
  ruleId?: string;
  severity: RuleSeverity;
  ruleCode: string;
  message: string;
  fieldPath?: string;
};

type IssueInboxCursor = {
  severityRank: 0 | 1;
  createdAt: string;
  id: string;
};

const INDIA_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

const ISSUE_INBOX_ORDER_BY = [
  { severity: "asc" },
  { createdAt: "asc" },
  { id: "asc" },
] satisfies Prisma.ValidationIssueOrderByWithRelationInput[];

const ISSUE_INBOX_SELECT = {
  id: true,
  productId: true,
  fieldPath: true,
  severity: true,
  message: true,
  createdAt: true,
  product: {
    select: {
      title: true,
      status: true,
      categoryId: true,
      category: {
        select: {
          name: true,
        },
      },
      variants: {
        select: {
          skuCode: true,
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        take: 1,
      },
    },
  },
} satisfies Prisma.ValidationIssueSelect;

type IssueInboxRecord = Prisma.ValidationIssueGetPayload<{ select: typeof ISSUE_INBOX_SELECT }>;

const COMPLIANCE_CACHE_TTL = 5 * 60;

@Injectable()
export class ComplianceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly accessPolicy: AccessPolicyService,
    private readonly cache: CacheService,
  ) {}

  async listRules(categoryId?: string) {
    return this.prisma.tenant().complianceRule.findMany({
      where: categoryId ? { categoryId } : undefined,
      orderBy: [{ updatedAt: "desc" }],
      take: 500,
    });
  }

  async createRule(dto: CreateComplianceRuleDto) {
    if (dto.categoryId) {
      await this.requireCategory(dto.categoryId);
    }
    if (dto.ruleType === "regex_field") {
      const pattern = typeof (dto.config as Record<string, unknown>).pattern === "string"
        ? String((dto.config as Record<string, unknown>).pattern)
        : undefined;
      if (!pattern) {
        throw new BadRequestException("regex_field rules require config.pattern to be a non-empty string.");
      }
      if (pattern.length > 300) {
        throw new BadRequestException("config.pattern must not exceed 300 characters.");
      }
      try {
        new RegExp(pattern);
      } catch {
        throw new BadRequestException("config.pattern is not a valid regular expression.");
      }
    }
    try {
      const rule = await this.prisma.tenant().complianceRule.create({
        data: {
          ruleCode: dto.ruleCode.trim().toUpperCase(),
          name: dto.name.trim(),
          categoryId: dto.categoryId ?? null,
          severity: dto.severity,
          ruleType: dto.ruleType,
          config: dto.config as Prisma.JsonObject,
          active: dto.active,
        },
      });
      await this.invalidateRuleCache();
      return rule;
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new BadRequestException("Rule code already exists.");
      }
      throw error;
    }
  }

  async updateRule(ruleId: string, dto: UpdateComplianceRuleDto) {
    await this.requireRule(ruleId);
    if (dto.categoryId) {
      await this.requireCategory(dto.categoryId);
    }
    if (dto.ruleType === "regex_field") {
      const pattern = typeof (dto.config as Record<string, unknown>).pattern === "string"
        ? String((dto.config as Record<string, unknown>).pattern)
        : undefined;
      if (!pattern) {
        throw new BadRequestException("regex_field rules require config.pattern to be a non-empty string.");
      }
      if (pattern.length > 300) {
        throw new BadRequestException("config.pattern must not exceed 300 characters.");
      }
      try {
        new RegExp(pattern);
      } catch {
        throw new BadRequestException("config.pattern is not a valid regular expression.");
      }
    }
    const rule = await this.prisma.tenant().complianceRule.update({
      where: { id: ruleId },
      data: {
        name: dto.name.trim(),
        categoryId: dto.categoryId ?? null,
        severity: dto.severity,
        ruleType: dto.ruleType,
        config: dto.config as Prisma.JsonObject,
        active: dto.active,
      },
    });
    await this.invalidateRuleCache();
    return rule;
  }

  async deleteRule(ruleId: string) {
    await this.requireRule(ruleId);
    await this.prisma.tenant().complianceRule.delete({ where: { id: ruleId } });
    await this.invalidateRuleCache();
  }

  private async invalidateRuleCache(): Promise<void> {
    const tenantKey = normalizeTenantKey(getTenantKeyFromContext());
    await this.cache.invalidatePattern(`compliance:rules:${tenantKey}:`).catch(() => undefined);
  }

  async getProductIssues(productId: string, actor?: PolicyActor) {
    const product = await this.requireProduct(productId);
    await this.accessPolicy.assertProductAccess(actor ?? {}, "view", product, "ValidationIssue");
    return this.prisma.tenant().validationIssue.findMany({
      where: { productId, status: ValidationIssueStatus.open },
      orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
    });
  }

  async listIssueInbox(query: IssueInboxQueryDto, actor?: PolicyActor) {
    const tenantKey = normalizeTenantKey(getTenantKeyFromContext());
    const limit = resolveCursorLimit(query.limit);
    const cursor = this.decodeIssueInboxCursor(query.cursor);
    let installationProductIds: Array<{ productId: string }> = [];
    if (query.installationId) {
      const installation = await this.loadInstallationScopeCandidate(tenantKey, query.installationId);
      if (!installation) {
        return this.buildEmptyIssueInboxResult(tenantKey, limit);
      }
      await this.accessPolicy.assertConnectorInstallationAccess(actor ?? {}, "view", {
        installationId: installation.id,
        connectorSlug: installation.connectorSlug,
        accountAlias: installation.accountAlias,
        resource: "ConnectorInstallation",
      });
      installationProductIds = await this.prisma.tenant(tenantKey).connectorSubmission.findMany({
        where: { installationId: query.installationId },
        select: { productId: true },
        distinct: ["productId"],
        take: 10_000,
      });
    }
    const productScopeWhere = await this.accessPolicy.buildProductScopeWhere(actor ?? {}, "view");

    const filters: Prisma.ValidationIssueWhereInput[] = [
      { status: ValidationIssueStatus.open },
    ];

    if (query.severity === "BLOCKING") {
      filters.push({ severity: RuleSeverity.error });
    } else if (query.severity === "WARNING") {
      filters.push({ severity: RuleSeverity.warning });
    }

    if (query.categoryId || query.productStatus) {
      const productWhere: Prisma.ProductWhereInput = {};
      if (query.categoryId) {
        productWhere.categoryId = query.categoryId;
      }
      if (query.productStatus) {
        productWhere.status = query.productStatus as RecordStatus;
      }
      filters.push({ product: productWhere });
    }

    if (query.installationId) {
      const productIds = installationProductIds.map((row) => row.productId);
      if (productIds.length === 0) {
        return this.buildEmptyIssueInboxResult(tenantKey, limit);
      }
      filters.push({ productId: { in: productIds } });
    }
    if (productScopeWhere) {
      filters.push({ product: productScopeWhere });
    }

    const cursorWhere = this.buildIssueInboxCursorWhere(cursor);
    if (cursorWhere) {
      filters.push(cursorWhere);
    }

    const where = filters.length === 1 ? filters[0] : { AND: filters };
    const rows = await this.prisma.tenant(tenantKey).validationIssue.findMany({
      where,
      orderBy: ISSUE_INBOX_ORDER_BY,
      take: limit + 1,
      select: ISSUE_INBOX_SELECT,
    });

    const hasNext = rows.length > limit;
    const pageRows = hasNext ? rows.slice(0, limit) : rows;
    const last = pageRows[pageRows.length - 1];
    const summary = await this.buildIssueInboxSummary(tenantKey);

    return {
      items: pageRows.map((row) => this.normalizeIssueInboxRow(row)),
      nextCursor: hasNext && last
        ? this.encodeIssueInboxCursor({
          severityRank: last.severity === "error" ? 0 : 1,
            createdAt: last.createdAt.toISOString(),
            id: last.id,
          })
        : null,
      limit,
      resolvedToday: summary.resolvedToday,
      resolvedYesterday: summary.resolvedYesterday,
      trend: this.resolveTrend(summary.resolvedToday, summary.resolvedYesterday),
    };
  }

  async resolveIssueInboxWarnings(issueIds: string[], actor?: PolicyActor) {
    const tenantKey = normalizeTenantKey(getTenantKeyFromContext());
    const uniqueIssueIds = Array.from(
      new Set(
        issueIds
          .map((issueId) => String(issueId ?? "").trim())
          .filter((issueId) => issueId.length > 0),
      ),
    );
    if (uniqueIssueIds.length === 0) {
      throw new BadRequestException("At least one issueId is required.");
    }

    const existingIssues = await this.prisma.tenant(tenantKey).validationIssue.findMany({
      where: {
        tenantKey,
        id: { in: uniqueIssueIds },
      },
      take: 1_000,
      select: {
        id: true,
        severity: true,
        status: true,
        productId: true,
        product: {
          select: {
            id: true,
            categoryId: true,
            brand: true,
          },
        },
      },
    });
    const issueMap = new Map(existingIssues.map((issue) => [issue.id, issue]));
    const resolvableIssueIds: string[] = [];
    let skippedBlocked = 0;
    let skippedAlreadyResolved = 0;
    let skippedMissing = 0;

    for (const issueId of uniqueIssueIds) {
      const issue = issueMap.get(issueId);
      if (!issue) {
        skippedMissing += 1;
        continue;
      }
      await this.accessPolicy.assertProductAccess(
        actor ?? {},
        "edit",
        {
          id: issue.productId,
          categoryId: issue.product?.categoryId ?? null,
          brand: issue.product?.brand ?? null,
        },
        "ValidationIssue",
      );
      if (issue.status !== ValidationIssueStatus.open) {
        skippedAlreadyResolved += 1;
        continue;
      }
      if (issue.severity !== RuleSeverity.warning) {
        skippedBlocked += 1;
        continue;
      }
      resolvableIssueIds.push(issue.id);
    }

    if (resolvableIssueIds.length === 0) {
      throw new BadRequestException("Only open warning issues can be resolved from inbox.");
    }

    const updateResult = await this.prisma.tenant(tenantKey).validationIssue.updateMany({
      where: {
        tenantKey,
        id: { in: resolvableIssueIds },
        severity: RuleSeverity.warning,
        status: ValidationIssueStatus.open,
      },
      data: {
        status: ValidationIssueStatus.resolved,
      },
    });

    return {
      requested: uniqueIssueIds.length,
      resolved: updateResult.count,
      skippedBlocked,
      skippedAlreadyResolved,
      skippedMissing,
    };
  }

  async validateAndPersistProduct(productId: string, actor?: PolicyActor) {
    const product = await this.prisma.tenant().product.findUnique({
      where: { id: productId },
      // Only fetch the scalar fields used by validateAndPersistProduct and its callees.
      // assertProductAccess uses categoryId/brand/vendorScopeKey; collectComplianceRuleIssues
      // uses title/description/brand/hsnCode/gstRate/attributes.  The full category record
      // is never accessed here — include: { category: true } was pulling unused data.
      select: {
        id: true,
        categoryId: true,
        brand: true,
        vendorScopeKey: true,
        title: true,
        description: true,
        hsnCode: true,
        gstRate: true,
        attributes: true,
      },
    });
    if (!product) {
      throw new NotFoundException("Product not found");
    }
    await this.accessPolicy.assertProductAccess(actor ?? {}, "edit", product);

    const attributes = this.asRecord(product.attributes);
    const issues: IssueDraft[] = [];

    this.applyGstHsnChecks(product.hsnCode, product.gstRate, issues);
    const [dynamicIssues, ruleIssues] = await Promise.all([
      this.collectDynamicAttributeIssues(product.categoryId, attributes),
      this.collectComplianceRuleIssues(product.categoryId, product, attributes),
    ]);
    issues.push(...dynamicIssues, ...ruleIssues);

    await this.prisma.tenant().$transaction(async (tx) => {
      await tx.validationIssue.deleteMany({ where: { productId } });
      if (issues.length > 0) {
        await tx.validationIssue.createMany({
          data: issues.map((issue) => ({
            productId,
            ruleId: issue.ruleId ?? null,
            severity: issue.severity,
            ruleCode: issue.ruleCode,
            message: issue.message,
            fieldPath: issue.fieldPath ?? null,
            status: ValidationIssueStatus.open,
          })),
        });
      }
    });

    return {
      productId,
      errorCount: issues.filter((issue) => issue.severity === RuleSeverity.error).length,
      warningCount: issues.filter((issue) => issue.severity === RuleSeverity.warning).length,
      issues,
    };
  }

  private applyGstHsnChecks(hsnCode: string | null, gstRate: number | null, issues: IssueDraft[]) {
    if (!hsnCode || !hsnCode.trim()) {
      issues.push({
        severity: RuleSeverity.error,
        ruleCode: "GST_HSN_REQUIRED",
        message: "HSN code is required.",
        fieldPath: "hsnCode",
      });
    } else if (!/^\d{4}(\d{2})?(\d{2})?$/.test(hsnCode.trim())) {
      issues.push({
        severity: RuleSeverity.error,
        ruleCode: "GST_HSN_FORMAT",
        message: "HSN code must be 4, 6, or 8 digits.",
        fieldPath: "hsnCode",
      });
    }

    if (gstRate === null || gstRate === undefined) {
      issues.push({
        severity: RuleSeverity.error,
        ruleCode: "GST_RATE_REQUIRED",
        message: "GST rate is required.",
        fieldPath: "gstRate",
      });
      return;
    }

    const allowedRates = [0, 3, 5, 12, 18, 28];
    if (!allowedRates.includes(gstRate)) {
      issues.push({
        severity: RuleSeverity.warning,
        ruleCode: "GST_RATE_UNCOMMON",
        message: "GST rate should typically be one of: 0, 3, 5, 12, 18, 28.",
        fieldPath: "gstRate",
      });
    }
  }

  private async collectDynamicAttributeIssues(
    categoryId: string,
    attributes: Record<string, unknown>,
  ): Promise<IssueDraft[]> {
    const tenantKey = normalizeTenantKey(getTenantKeyFromContext());
    const cacheKey = `compliance:attrs:${tenantKey}:${categoryId}`;
    const definitions = await this.cache.getOrSet(
      cacheKey,
      () => this.prisma.tenant().attributeDefinition.findMany({
        where: { categoryId, appliesTo: "product" },
        orderBy: [{ key: "asc" }],
        take: 500,
      }),
      COMPLIANCE_CACHE_TTL,
    );

    const issues: IssueDraft[] = [];
    for (const def of definitions) {
      const value = attributes[def.key];
      if (def.required && this.isEmpty(value)) {
        issues.push({
          severity: RuleSeverity.error,
          ruleCode: `ATTR_REQUIRED_${def.key.toUpperCase()}`,
          message: `${def.name} is required.`,
          fieldPath: `attributes.${def.key}`,
        });
        continue;
      }

      if (this.isEmpty(value)) {
        continue;
      }

      const typeError = this.validateDataType(def.dataType, value);
      if (typeError) {
        issues.push({
          severity: RuleSeverity.error,
          ruleCode: `ATTR_TYPE_${def.key.toUpperCase()}`,
          message: typeError,
          fieldPath: `attributes.${def.key}`,
        });
      }

      const allowed = this.asArray(def.allowedValues);
      if (allowed.length > 0 && !allowed.includes(value as never)) {
        issues.push({
          severity: RuleSeverity.warning,
          ruleCode: `ATTR_ALLOWED_${def.key.toUpperCase()}`,
          message: `${def.name} should match one of the allowed values.`,
          fieldPath: `attributes.${def.key}`,
        });
      }
    }
    return issues;
  }

  private async collectComplianceRuleIssues(
    categoryId: string,
    product: {
      title: string;
      description: string;
      brand: string;
      hsnCode: string | null;
      gstRate: number | null;
      attributes: Prisma.JsonValue;
    },
    attributes: Record<string, unknown>,
  ): Promise<IssueDraft[]> {
    const tenantKey = normalizeTenantKey(getTenantKeyFromContext());
    const cacheKey = `compliance:rules:${tenantKey}:${categoryId}`;
    const rules = await this.cache.getOrSet(
      cacheKey,
      () => this.prisma.tenant().complianceRule.findMany({
        where: { active: true, OR: [{ categoryId: null }, { categoryId }] },
        orderBy: [{ updatedAt: "desc" }],
        take: 500,
      }),
      COMPLIANCE_CACHE_TTL,
    );

    const issues: IssueDraft[] = [];
    for (const rule of rules) {
      const config = this.asRecord(rule.config);
      const field = typeof config.field === "string" ? config.field : undefined;
      if (!field) {
        continue;
      }

      const value = this.getFieldValue(field, product, attributes);
      const message = typeof config.message === "string" ? config.message : undefined;

      if (rule.ruleType === RuleType.required_field && this.isEmpty(value)) {
        issues.push({
          ruleId: rule.id,
          severity: rule.severity,
          ruleCode: rule.ruleCode,
          message: message ?? `${field} is required.`,
          fieldPath: field,
        });
      }

      if (rule.ruleType === RuleType.regex_field && !this.isEmpty(value)) {
        const pattern = typeof config.pattern === "string" ? config.pattern : undefined;
        if (!pattern) {
          continue;
        }
        let regexMatches: boolean;
        try {
          regexMatches = new RegExp(pattern).test(String(value));
        } catch {
          // Invalid pattern stored in DB — skip rather than throw; createRule now rejects invalid patterns at write time.
          continue;
        }
        if (!regexMatches) {
          issues.push({
            ruleId: rule.id,
            severity: rule.severity,
            ruleCode: rule.ruleCode,
            message: message ?? `${field} does not match expected format.`,
            fieldPath: field,
          });
        }
      }

      if (rule.ruleType === RuleType.value_in_set && !this.isEmpty(value)) {
        const allowedValues = this.asArray(config.values);
        if (allowedValues.length === 0) {
          continue;
        }
        if (!allowedValues.includes(value as never)) {
          issues.push({
            ruleId: rule.id,
            severity: rule.severity,
            ruleCode: rule.ruleCode,
            message: message ?? `${field} should be one of the allowed values.`,
            fieldPath: field,
          });
        }
      }
    }
    return issues;
  }

  private validateDataType(type: string, value: unknown) {
    switch (type) {
      case "text":
        return typeof value === "string" ? null : "Value must be text.";
      case "number":
        return typeof value === "number" || (typeof value === "string" && !Number.isNaN(Number(value)))
          ? null
          : "Value must be numeric.";
      case "boolean":
        return typeof value === "boolean" || value === "true" || value === "false"
          ? null
          : "Value must be boolean.";
      case "select":
        return typeof value === "string" || typeof value === "number"
          ? null
          : "Value must be a selectable primitive.";
      case "json":
        return typeof value === "object" ? null : "Value must be JSON object.";
      default:
        return null;
    }
  }

  private getFieldValue(
    fieldPath: string,
    product: {
      title: string;
      description: string;
      brand: string;
      hsnCode: string | null;
      gstRate: number | null;
      attributes: Prisma.JsonValue;
    },
    attributes: Record<string, unknown>,
  ) {
    if (fieldPath.startsWith("attributes.")) {
      const key = fieldPath.replace("attributes.", "");
      return attributes[key];
    }
    const direct = product as unknown as Record<string, unknown>;
    return direct[fieldPath];
  }

  private asRecord(value: Prisma.JsonValue): Record<string, unknown> {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private asArray(value: unknown): unknown[] {
    if (Array.isArray(value)) {
      return value;
    }
    if (value && typeof value === "object" && "values" in (value as Record<string, unknown>)) {
      const nested = (value as Record<string, unknown>).values;
      return Array.isArray(nested) ? nested : [];
    }
    return [];
  }

  private isEmpty(value: unknown) {
    return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
  }

  private buildSuggestedFix(fieldPath: string | null): string {
    if (!fieldPath || fieldPath.trim().length === 0) {
      return "Update the product details and re-run compliance validation.";
    }
    return `Update ${fieldPath.trim()} and re-run compliance validation.`;
  }

  private decodeIssueInboxCursor(cursor: string | undefined): IssueInboxCursor | null {
    const value = String(cursor ?? "").trim();
    if (!value) {
      return null;
    }
    try {
      const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<string, unknown>;
      const severityRankRaw = Number(decoded.severityRank);
      const createdAt = String(decoded.createdAt ?? "").trim();
      const id = String(decoded.id ?? "").trim();
      if ((severityRankRaw !== 0 && severityRankRaw !== 1) || !createdAt || !id) {
        return null;
      }
      const parsedDate = new Date(createdAt);
      if (Number.isNaN(parsedDate.getTime())) {
        return null;
      }
      return {
        severityRank: severityRankRaw as 0 | 1,
        createdAt: parsedDate.toISOString(),
        id,
      };
    } catch {
      return null;
    }
  }

  private normalizeIssueInboxRow(row: IssueInboxRecord) {
    return {
      issueId: row.id,
      productId: row.productId,
      productName: row.product.title,
      sku: row.product.variants[0]?.skuCode ?? "-",
      productStatus: row.product.status,
      categoryId: row.product.categoryId,
      categoryName: row.product.category?.name ?? "Uncategorized",
      fieldPath: row.fieldPath,
      severity: row.severity === "error" ? "BLOCKING" : "WARNING",
      sellerMessage: row.message,
      suggestedFix: this.buildSuggestedFix(row.fieldPath),
      detectedAt: row.createdAt.toISOString(),
    };
  }

  private buildIssueInboxCursorWhere(cursor: IssueInboxCursor | null): Prisma.ValidationIssueWhereInput | undefined {
    if (!cursor) {
      return undefined;
    }

    const createdAt = new Date(cursor.createdAt);
    const sameSeverityAfterCursor: Prisma.ValidationIssueWhereInput = {
      OR: [
        { createdAt: { gt: createdAt } },
        {
          AND: [
            { createdAt },
            { id: { gt: cursor.id } },
          ],
        },
      ],
    };

    if (cursor.severityRank === 0) {
      return {
        OR: [
          { severity: RuleSeverity.warning },
          {
            AND: [
              { severity: RuleSeverity.error },
              sameSeverityAfterCursor,
            ],
          },
        ],
      };
    }

    return {
      AND: [
        { severity: RuleSeverity.warning },
        sameSeverityAfterCursor,
      ],
    };
  }

  private async buildIssueInboxSummary(tenantKey: string) {
    const today = this.getIndiaDayBounds(0);
    const yesterday = this.getIndiaDayBounds(-1);
    const baseWhere: Prisma.ValidationIssueWhereInput = {
      status: ValidationIssueStatus.resolved,
      severity: RuleSeverity.warning,
    };

    const [resolvedToday, resolvedYesterday] = await Promise.all([
      this.prisma.tenant(tenantKey).validationIssue.count({
        where: {
          AND: [
            baseWhere,
            {
              updatedAt: {
                gte: today.start,
                lt: today.end,
              },
            },
          ],
        },
      }),
      this.prisma.tenant(tenantKey).validationIssue.count({
        where: {
          AND: [
            baseWhere,
            {
              updatedAt: {
                gte: yesterday.start,
                lt: yesterday.end,
              },
            },
          ],
        },
      }),
    ]);

    return { resolvedToday, resolvedYesterday };
  }

  private getIndiaDayBounds(dayOffset: number) {
    const indiaNow = new Date(Date.now() + INDIA_OFFSET_MS);
    const startUtcMs =
      Date.UTC(indiaNow.getUTCFullYear(), indiaNow.getUTCMonth(), indiaNow.getUTCDate() + dayOffset) - INDIA_OFFSET_MS;

    return {
      start: new Date(startUtcMs),
      end: new Date(startUtcMs + DAY_MS),
    };
  }

  private resolveTrend(resolvedToday: number, resolvedYesterday: number) {
    if (resolvedToday > resolvedYesterday) {
      return "up";
    }
    if (resolvedToday < resolvedYesterday) {
      return "down";
    }
    return "flat";
  }

  private encodeIssueInboxCursor(cursor: IssueInboxCursor): string {
    return Buffer.from(
      JSON.stringify({
        severityRank: cursor.severityRank,
        createdAt: cursor.createdAt,
        id: cursor.id,
      }),
      "utf8",
    ).toString("base64url");
  }

  private async buildEmptyIssueInboxResult(tenantKey: string, limit: number) {
    const summary = await this.buildIssueInboxSummary(tenantKey);
    return {
      items: [],
      nextCursor: null,
      limit,
      resolvedToday: summary.resolvedToday,
      resolvedYesterday: summary.resolvedYesterday,
      trend: this.resolveTrend(summary.resolvedToday, summary.resolvedYesterday),
    };
  }

  private async loadInstallationScopeCandidate(tenantKey: string, installationId: string) {
    const installation = await this.prisma.tenant(tenantKey).connectorInstallation.findUnique({
      where: { id: installationId },
      select: {
        id: true,
        accountAlias: true,
        connectorId: true,
      },
    });
    if (!installation) {
      return null;
    }
    const definition = await this.prisma.tenant(tenantKey).connectorDefinition.findUnique({
      where: { id: installation.connectorId },
      select: { slug: true },
    });
    return {
      id: installation.id,
      accountAlias: installation.accountAlias,
      connectorSlug: definition?.slug ?? null,
    };
  }

  private async requireRule(ruleId: string) {
    const rule = await this.prisma.tenant().complianceRule.findUnique({ where: { id: ruleId } });
    if (!rule) {
      throw new NotFoundException("Compliance rule not found");
    }
    return rule;
  }

  private async requireCategory(categoryId: string) {
    const category = await this.prisma.tenant().category.findUnique({ where: { id: categoryId } });
    if (!category) {
      throw new NotFoundException("Category not found");
    }
    return category;
  }

  private async requireProduct(productId: string) {
    const product = await this.prisma.tenant().product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException("Product not found");
    }
    return product;
  }
}
