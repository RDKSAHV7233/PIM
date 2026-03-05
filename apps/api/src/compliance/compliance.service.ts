import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, RuleSeverity, RuleType, ValidationIssueStatus } from "@prisma/client";
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

type IssueInboxRow = {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  productStatus: string;
  categoryId: string;
  categoryName: string;
  fieldPath: string | null;
  severity: RuleSeverity;
  message: string;
  createdAt: Date;
};

type IssueInboxCursor = {
  severityRank: 0 | 1;
  createdAt: string;
  id: string;
};

@Injectable()
export class ComplianceService {
  constructor(private readonly prisma: PrismaService) {}

  async listRules(categoryId?: string) {
    return this.prisma.tenant().complianceRule.findMany({
      where: categoryId ? { categoryId } : undefined,
      orderBy: [{ updatedAt: "desc" }],
    });
  }

  async createRule(dto: CreateComplianceRuleDto) {
    if (dto.categoryId) {
      await this.requireCategory(dto.categoryId);
    }
    try {
      return await this.prisma.tenant().complianceRule.create({
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
    return this.prisma.tenant().complianceRule.update({
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
  }

  async deleteRule(ruleId: string) {
    await this.requireRule(ruleId);
    await this.prisma.tenant().complianceRule.delete({ where: { id: ruleId } });
  }

  async getProductIssues(productId: string) {
    await this.requireProduct(productId);
    return this.prisma.tenant().validationIssue.findMany({
      where: { productId, status: ValidationIssueStatus.open },
      orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
    });
  }

  async listIssueInbox(query: IssueInboxQueryDto) {
    const tenantKey = normalizeTenantKey(getTenantKeyFromContext());
    const limit = resolveCursorLimit(query.limit);
    const cursor = this.decodeIssueInboxCursor(query.cursor);

    const whereClauses: string[] = [
      `vi."tenantKey" = $1`,
      `vi.status = 'open'`,
    ];
    const params: Array<string | number | Date> = [tenantKey];

    if (query.severity === "BLOCKING") {
      params.push("error");
      whereClauses.push(`vi.severity = $${params.length}::"RuleSeverity"`);
    } else if (query.severity === "WARNING") {
      params.push("warning");
      whereClauses.push(`vi.severity = $${params.length}::"RuleSeverity"`);
    }

    if (query.categoryId) {
      params.push(query.categoryId);
      whereClauses.push(`p."categoryId" = $${params.length}`);
    }

    if (query.productStatus) {
      params.push(query.productStatus);
      whereClauses.push(`p.status::text = $${params.length}`);
    }

    if (query.installationId) {
      params.push(query.installationId);
      whereClauses.push(`
        EXISTS (
          SELECT 1
          FROM connector_submissions cs
          WHERE cs.tenant_key = $1
            AND cs.product_id = vi."productId"
            AND cs.installation_id = $${params.length}
        )
      `);
    }

    if (cursor) {
      params.push(cursor.severityRank);
      const rankParam = params.length;
      params.push(cursor.createdAt);
      const createdAtParam = params.length;
      params.push(cursor.id);
      const idParam = params.length;
      whereClauses.push(`
        (
          (CASE WHEN vi.severity = 'error' THEN 0 ELSE 1 END > $${rankParam})
          OR (
            CASE WHEN vi.severity = 'error' THEN 0 ELSE 1 END = $${rankParam}
            AND (
              vi."createdAt" > $${createdAtParam}::timestamptz
              OR (vi."createdAt" = $${createdAtParam}::timestamptz AND vi.id > $${idParam})
            )
          )
        )
      `);
    }

    params.push(limit + 1);
    const limitParam = params.length;

    // RLS-BYPASS: manual tenant filter
    const rows = await this.prisma.tenant(tenantKey).$queryRawUnsafe<IssueInboxRow[]>(
      `
      SELECT
        vi.id AS id,
        vi."productId" AS "productId",
        p.title AS "productName",
        COALESCE(v."skuCode", '-') AS sku,
        p.status::text AS "productStatus",
        p."categoryId" AS "categoryId",
        c.name AS "categoryName",
        vi."fieldPath" AS "fieldPath",
        vi.severity AS severity,
        vi.message AS message,
        vi."createdAt" AS "createdAt"
      FROM "ValidationIssue" vi
      JOIN "Product" p ON p.id = vi."productId"
      LEFT JOIN "Category" c ON c.id = p."categoryId"
      LEFT JOIN LATERAL (
        SELECT vv."skuCode"
        FROM "Variant" vv
        WHERE vv."productId" = p.id
        ORDER BY vv."createdAt" ASC, vv.id ASC
        LIMIT 1
      ) v ON TRUE
      WHERE ${whereClauses.join(" AND ")}
      ORDER BY
        CASE WHEN vi.severity = 'error' THEN 0 ELSE 1 END ASC,
        vi."createdAt" ASC,
        vi.id ASC
      LIMIT $${limitParam}
      `,
      ...params,
    );

    const hasNext = rows.length > limit;
    const pageRows = hasNext ? rows.slice(0, limit) : rows;
    const last = pageRows[pageRows.length - 1];

    // RLS-BYPASS: manual tenant filter
    const summaryRows = await this.prisma.tenant(tenantKey).$queryRawUnsafe<
      Array<{ resolvedToday: number; resolvedYesterday: number }>
    >(
      `
      SELECT
        COUNT(*) FILTER (
          WHERE (vi."updatedAt" AT TIME ZONE 'Asia/Kolkata')::date =
            (NOW() AT TIME ZONE 'Asia/Kolkata')::date
        )::int AS "resolvedToday",
        COUNT(*) FILTER (
          WHERE (vi."updatedAt" AT TIME ZONE 'Asia/Kolkata')::date =
            ((NOW() AT TIME ZONE 'Asia/Kolkata')::date - 1)
        )::int AS "resolvedYesterday"
      FROM "ValidationIssue" vi
      WHERE vi."tenantKey" = $1
        AND vi.status = 'resolved'
        AND vi.severity = 'warning'
      `,
      tenantKey,
    );

    const summary = summaryRows[0] ?? { resolvedToday: 0, resolvedYesterday: 0 };

    return {
      items: pageRows.map((row) => ({
        issueId: row.id,
        productId: row.productId,
        productName: row.productName,
        sku: row.sku,
        productStatus: row.productStatus,
        categoryId: row.categoryId,
        categoryName: row.categoryName,
        fieldPath: row.fieldPath,
        severity: row.severity === "error" ? "BLOCKING" : "WARNING",
        sellerMessage: row.message,
        suggestedFix: this.buildSuggestedFix(row.fieldPath),
        detectedAt: row.createdAt.toISOString(),
      })),
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
      trend:
        summary.resolvedToday > summary.resolvedYesterday
          ? "up"
          : summary.resolvedToday < summary.resolvedYesterday
            ? "down"
            : "flat",
    };
  }

  async resolveIssueInboxWarnings(issueIds: string[]) {
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
      select: {
        id: true,
        severity: true,
        status: true,
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

  async validateAndPersistProduct(productId: string) {
    const product = await this.prisma.tenant().product.findUnique({
      where: { id: productId },
      include: { category: true },
    });
    if (!product) {
      throw new NotFoundException("Product not found");
    }

    const attributes = this.asRecord(product.attributes);
    const issues: IssueDraft[] = [];

    this.applyGstHsnChecks(product.hsnCode, product.gstRate, issues);
    await this.applyDynamicAttributeChecks(product.categoryId, attributes, issues);
    await this.applyComplianceRuleChecks(product.categoryId, product, attributes, issues);

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

  private async applyDynamicAttributeChecks(
    categoryId: string,
    attributes: Record<string, unknown>,
    issues: IssueDraft[],
  ) {
    const definitions = await this.prisma.tenant().attributeDefinition.findMany({
      where: {
        categoryId,
        appliesTo: "product",
      },
      orderBy: [{ key: "asc" }],
    });

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
  }

  private async applyComplianceRuleChecks(
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
    issues: IssueDraft[],
  ) {
    const rules = await this.prisma.tenant().complianceRule.findMany({
      where: {
        active: true,
        OR: [{ categoryId: null }, { categoryId }],
      },
      orderBy: [{ updatedAt: "desc" }],
    });

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
        const regex = new RegExp(pattern);
        if (!regex.test(String(value))) {
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
