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

// Cap on distinct productIds fetched for an installation-scoped issue-inbox
// filter — prevents OOM on large installations (e.g. 10k+ Amazon submissions).
// See listIssueInbox()'s installationProductIds block for why this can't yet
// be a real SQL subquery (ConnectorSubmission has no Prisma relation to
// Product), and how ISSUE_INBOX_INSTALLATION_SCOPE_TRUNCATED is derived from it.
const ISSUE_INBOX_INSTALLATION_PRODUCT_CAP = 10_000;

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

/** Cache TTL for attribute definitions and compliance rules — admin-level config that rarely changes. */
const COMPLIANCE_CACHE_TTL_SECONDS = 5 * 60;

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
      take: 500, // defensive cap — admin-configured rules per tenant
    });
  }

  async createRule(dto: CreateComplianceRuleDto) {
    if (dto.categoryId) {
      await this.requireCategory(dto.categoryId);
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
      await this.invalidateRulesCache();
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
    await this.invalidateRulesCache();
    return rule;
  }

  async deleteRule(ruleId: string) {
    await this.requireRule(ruleId);
    await this.prisma.tenant().complianceRule.delete({ where: { id: ruleId } });
    await this.invalidateRulesCache();
  }

  /** Bust all compliance-rule cache entries for the current tenant. */
  private async invalidateRulesCache(): Promise<void> {
    const tenantKey = normalizeTenantKey(getTenantKeyFromContext());
    await this.cache.invalidateByPrefix(`compliance:rules:${tenantKey}`);
  }

  async getProductIssues(productId: string, actor?: PolicyActor) {
    const product = await this.requireProduct(productId);
    await this.accessPolicy.assertProductAccess(actor ?? {}, "view", product, "ValidationIssue");
    return this.prisma.tenant().validationIssue.findMany({
      where: { productId, status: ValidationIssueStatus.open },
      orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
      take: 500,
    });
  }

  async listIssueInbox(query: IssueInboxQueryDto, actor?: PolicyActor) {
    const tenantKey = normalizeTenantKey(getTenantKeyFromContext());
    const limit = resolveCursorLimit(query.limit);
    const cursor = this.decodeIssueInboxCursor(query.cursor);
    let installationProductIds: Array<{ productId: string }> = [];
    // True when the distinct-productId fetch below found MORE than
    // ISSUE_INBOX_INSTALLATION_PRODUCT_CAP rows — see the CAP+1 fetch just
    // below for why. Threaded through to every return path so API consumers
    // can tell an incomplete result from a genuinely complete one, instead
    // of the cap being invisible.
    let installationScopeTruncated = false;
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
      // TODO: replace this IN-clause approach with a SQL subquery once
      // ConnectorSubmission gains a Prisma relation to Product (schema migration required).
      // Until then, orderBy(productId) makes which rows are kept under the cap
      // deterministic across calls (not the DB's unspecified default row order).
      // Fetch CAP+1 rows: a plain `take: CAP` can't tell "exactly CAP matching
      // rows" apart from "more than CAP, silently cut off here" — an
      // installation with precisely CAP distinct products would otherwise be
      // reported as truncated when nothing was actually cut off (the same
      // false-positive the audit-export truncation fix avoids by fetching
      // CAP+1 rather than inferring truncation from `length === CAP`).
      const fetchedProductIds = await this.prisma.tenant(tenantKey).connectorSubmission.findMany({
        where: { installationId: query.installationId },
        select: { productId: true },
        distinct: ["productId"],
        orderBy: { productId: "asc" },
        take: ISSUE_INBOX_INSTALLATION_PRODUCT_CAP + 1,
      });
      installationScopeTruncated = fetchedProductIds.length > ISSUE_INBOX_INSTALLATION_PRODUCT_CAP;
      installationProductIds = installationScopeTruncated
        ? fetchedProductIds.slice(0, ISSUE_INBOX_INSTALLATION_PRODUCT_CAP)
        : fetchedProductIds;
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

    if (query.fieldFamily) {
      filters.push(this.buildFieldFamilyWhere(query.fieldFamily));
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
        return this.buildEmptyIssueInboxResult(tenantKey, limit, installationScopeTruncated);
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
      installationScopeTruncated,
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

    // Access checks per issue are independent and may each hit the DB —
    // run in parallel. Behaviour matches the prior sequential loop: a denial
    // throws and aborts the request (no per-issue swallow).
    const presentIssues = uniqueIssueIds
      .map((issueId) => ({ issueId, issue: issueMap.get(issueId) }))
      .filter((entry): entry is { issueId: string; issue: NonNullable<ReturnType<typeof issueMap.get>> } => {
        if (!entry.issue) {
          skippedMissing += 1;
          return false;
        }
        return true;
      });

    await Promise.all(
      presentIssues.map(({ issue }) =>
        this.accessPolicy.assertProductAccess(
          actor ?? {},
          "edit",
          {
            id: issue.productId,
            categoryId: issue.product?.categoryId ?? null,
            brand: issue.product?.brand ?? null,
          },
          "ValidationIssue",
        ),
      ),
    );

    for (const { issue } of presentIssues) {
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
      // Narrow select to only the fields consumed by compliance checks and access-policy.
      // Avoids loading ~15 unused columns (description, assigneeId, slaDeadlineAt, …)
      // and the full Category row (path, tenantKey, timestamps) on every product save /
      // approve / bulk-import row.
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
        status: true,
        category: { select: { name: true } },
      },
    });
    if (!product) {
      throw new NotFoundException("Product not found");
    }
    await this.accessPolicy.assertProductAccess(actor ?? {}, "edit", product);

    const attributes = this.asRecord(product.attributes);
    const issues: IssueDraft[] = [];

    this.applyGstHsnChecks(product.hsnCode, product.gstRate, issues);
    // All three checks are independent DB round-trips — run them in parallel.
    // Impact: every product save/approve/bulk-import row benefits.
    const [dynamicIssues, ruleIssues, pricingIssues] = await Promise.all([
      this.collectDynamicAttributeIssues(product.categoryId, attributes),
      this.collectComplianceRuleIssues(product.categoryId, product, attributes),
      this.collectPricingIssues(productId),
    ]);
    issues.push(...dynamicIssues, ...ruleIssues, ...pricingIssues);

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
      COMPLIANCE_CACHE_TTL_SECONDS,
      () => this.prisma.tenant().attributeDefinition.findMany({
        where: { categoryId, appliesTo: "product" },
        orderBy: [{ key: "asc" }],
      }),
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
      COMPLIANCE_CACHE_TTL_SECONDS,
      () => this.prisma.tenant().complianceRule.findMany({
        where: {
          active: true,
          OR: [{ categoryId: null }, { categoryId }],
        },
        orderBy: [{ updatedAt: "desc" }],
      }),
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
    return issues;
  }

  /**
   * Checks whether variants are priced in the tenant's default active price list.
   *
   * Rules:
   *  - PRICING_NO_DEFAULT_PRICES (warning) — all variants unpriced in the default list
   *  - PRICING_INCOMPLETE       (warning) — some but not all variants have prices
   *
   * Non-fatal: returns [] if no default price list is configured or the product has no
   * variants yet (product is still being built).
   *
   * The default price list lookup is cached per-tenant for COMPLIANCE_CACHE_TTL_SECONDS.
   * The null/missing case is wrapped in a tagged-union so "no list configured" is itself
   * cacheable — the cache sentinel is the null value itself.
   */
  private async collectPricingIssues(productId: string): Promise<IssueDraft[]> {
    const tenantKey = normalizeTenantKey(getTenantKeyFromContext());

    type DefaultPlCache = { found: false } | { found: true; id: string; name: string };
    const cacheKey = `compliance:default-pricelist:${tenantKey}`;
    const cached = await this.cache.getOrSet<DefaultPlCache>(
      cacheKey,
      COMPLIANCE_CACHE_TTL_SECONDS,
      async () => {
        const pl = await this.prisma.tenant().priceList.findFirst({
          where: { tenantKey, isDefault: true, status: "active" },
          select: { id: true, name: true },
        });
        return pl ? { found: true, id: pl.id, name: pl.name } : { found: false };
      },
    );

    // No default price list configured — pricing not set up yet; skip silently.
    if (!cached.found) {
      return [];
    }

    // Load variants; for each, a take:1 prices sub-query to check existence only.
    const variants = await this.prisma.tenant().variant.findMany({
      where: { productId, tenantKey },
      select: {
        id: true,
        prices: {
          where: {
            priceListId: cached.id,
            tenantKey,
            OR: [{ mrp: { not: null } }, { sellingPrice: { not: null } }],
          },
          select: { id: true },
          take: 1,
        },
      },
    });

    // Product has no variants yet — skip pricing check (not a pricing issue).
    if (variants.length === 0) {
      return [];
    }

    const totalCount = variants.length;
    const unpricedCount = variants.filter((v) => v.prices.length === 0).length;
    const issues: IssueDraft[] = [];

    if (unpricedCount === totalCount) {
      issues.push({
        severity: RuleSeverity.warning,
        ruleCode: "PRICING_NO_DEFAULT_PRICES",
        message: `No variants have prices set in "${cached.name}" (default price list). Set prices before exporting to marketplaces.`,
        fieldPath: "pricing",
      });
    } else if (unpricedCount > 0) {
      const noun = unpricedCount === 1 ? "variant has" : "variants have";
      issues.push({
        severity: RuleSeverity.warning,
        ruleCode: "PRICING_INCOMPLETE",
        message: `${unpricedCount} of ${totalCount} ${noun} no price in "${cached.name}" (default price list).`,
        fieldPath: "pricing",
      });
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
    const FIELD_SUGGESTIONS: Record<string, string> = {
      hsnCode: "Set the HSN Code in the product editor Content tab and re-run validation.",
      gstRate: "Set the GST Rate in the product editor Content tab and re-run validation.",
      taxCodes: "Add the required international tax code in the product editor Content tab → International Tax Codes section.",
      pricing: "Set prices in the default price list via Settings → Pricing.",
    };
    const known = FIELD_SUGGESTIONS[fieldPath.trim()];
    if (known) return known;
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

  /**
   * Translates a field-family filter value into a Prisma `ValidationIssue` where clause.
   *
   * Family → fieldPath mapping mirrors the `issueFamily()` function in the web UI so that
   * the filter dropdown and the "Top issue families" breakdown stay in sync.
   *
   * PRICING   → fieldPath = "pricing"
   * GST_TAX   → fieldPath in ["hsnCode", "gstRate"]
   * ATTRIBUTES → fieldPath starts with "attributes."
   * CORE      → fieldPath in ["title", "brand", "description"]
   * MEDIA     → fieldPath contains "image" | "media" | "asset"
   */
  private buildFieldFamilyWhere(family: string): Prisma.ValidationIssueWhereInput {
    switch (family) {
      case "PRICING":
        return { fieldPath: "pricing" };
      case "GST_TAX":
        // taxCodes = structured international tax codes (UK/UAE/US/AU); grouped with India GST/HSN
        return { fieldPath: { in: ["hsnCode", "gstRate", "taxCodes"] } };
      case "ATTRIBUTES":
        return { fieldPath: { startsWith: "attributes." } };
      case "CORE":
        return { fieldPath: { in: ["title", "brand", "description"] } };
      case "MEDIA":
        return {
          OR: [
            { fieldPath: { contains: "image" } },
            { fieldPath: { contains: "media" } },
            { fieldPath: { contains: "asset" } },
          ],
        };
      default:
        return {};
    }
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

  private async buildEmptyIssueInboxResult(tenantKey: string, limit: number, installationScopeTruncated = false) {
    const summary = await this.buildIssueInboxSummary(tenantKey);
    return {
      items: [],
      nextCursor: null,
      limit,
      resolvedToday: summary.resolvedToday,
      resolvedYesterday: summary.resolvedYesterday,
      trend: this.resolveTrend(summary.resolvedToday, summary.resolvedYesterday),
      installationScopeTruncated,
    };
  }

  // RLS-BYPASS: manual tenant filter — this.prisma.tenant(tenantKey) selects the right
  // per-tenant Prisma Client *instance*, but that instance's tenant-scope extension only
  // instruments ORM query methods (findMany/findUnique/etc.), not $queryRaw. Found during
  // a QA-plan sprint (2026-09-20) that this WHERE clause never carried a tenant_key filter
  // at all — an installationId belonging to a DIFFERENT tenant would resolve successfully
  // here instead of correctly returning null, and for an admin actor the caller's own
  // assertConnectorInstallationAccess() check is a no-op (`if (this.isAdmin(actor)) return;`),
  // so the leak reached the caller unfiltered. Contained from leaking actual product/issue
  // DATA only because the *separate* connectorSubmission.findMany() call a few lines up in
  // listIssueInbox() goes through the ORM extension and is correctly tenant-scoped — but the
  // installation's own id/accountAlias/connectorSlug were disclosable cross-tenant on their own.
  private async loadInstallationScopeCandidate(tenantKey: string, installationId: string) {
    const rows = await this.prisma.tenant(tenantKey).$queryRaw<
      Array<{ id: string; accountAlias: string; connectorSlug: string | null }>
    >(Prisma.sql`
      SELECT
        ci.id          AS "id",
        ci.account_alias AS "accountAlias",
        cd.slug        AS "connectorSlug"
      FROM connector_installations ci
      LEFT JOIN connector_definitions cd ON cd.id = ci.connector_id
      WHERE ci.id = ${installationId} AND ci.tenant_key = ${tenantKey}
      LIMIT 1
    `);
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      accountAlias: row.accountAlias,
      connectorSlug: row.connectorSlug ?? null,
    };
  }

  private async requireRule(ruleId: string) {
    const rule = await this.prisma
      .tenant()
      .complianceRule.findUnique({ where: { id: ruleId }, select: { id: true } });
    if (!rule) {
      throw new NotFoundException("Compliance rule not found");
    }
    return rule;
  }

  private async requireCategory(categoryId: string) {
    const category = await this.prisma
      .tenant()
      .category.findUnique({ where: { id: categoryId }, select: { id: true } });
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
