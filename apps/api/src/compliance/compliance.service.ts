import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, RuleSeverity, RuleType, ValidationIssueStatus } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreateComplianceRuleDto } from "./dto/create-compliance-rule.dto";
import { UpdateComplianceRuleDto } from "./dto/update-compliance-rule.dto";

type IssueDraft = {
  ruleId?: string;
  severity: RuleSeverity;
  ruleCode: string;
  message: string;
  fieldPath?: string;
};

@Injectable()
export class ComplianceService {
  constructor(private readonly prisma: PrismaService) {}

  async listRules(categoryId?: string) {
    return this.prisma.complianceRule.findMany({
      where: categoryId ? { categoryId } : undefined,
      orderBy: [{ updatedAt: "desc" }],
    });
  }

  async createRule(dto: CreateComplianceRuleDto) {
    if (dto.categoryId) {
      await this.requireCategory(dto.categoryId);
    }
    try {
      return await this.prisma.complianceRule.create({
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
    return this.prisma.complianceRule.update({
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
    await this.prisma.complianceRule.delete({ where: { id: ruleId } });
  }

  async getProductIssues(productId: string) {
    await this.requireProduct(productId);
    return this.prisma.validationIssue.findMany({
      where: { productId, status: ValidationIssueStatus.open },
      orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
    });
  }

  async validateAndPersistProduct(productId: string) {
    const product = await this.prisma.product.findUnique({
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

    await this.prisma.$transaction(async (tx) => {
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
    const definitions = await this.prisma.attributeDefinition.findMany({
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
    const rules = await this.prisma.complianceRule.findMany({
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

  private async requireRule(ruleId: string) {
    const rule = await this.prisma.complianceRule.findUnique({ where: { id: ruleId } });
    if (!rule) {
      throw new NotFoundException("Compliance rule not found");
    }
    return rule;
  }

  private async requireCategory(categoryId: string) {
    const category = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!category) {
      throw new NotFoundException("Category not found");
    }
    return category;
  }

  private async requireProduct(productId: string) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException("Product not found");
    }
    return product;
  }
}
