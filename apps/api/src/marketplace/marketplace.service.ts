import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
  ExportJobStatus,
  MarketplaceChannel as MarketplaceChannelDb,
  Prisma,
  RuleSeverity,
  ValidationIssueStatus,
} from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { CreateExportJobDto } from "./dto/create-export-job.dto";
import { CreateMappingTemplateDto } from "./dto/create-mapping-template.dto";
import { MARKETPLACE_CHANNELS } from "./dto/simulate-marketplace.dto";

type MarketplaceChannel = (typeof MARKETPLACE_CHANNELS)[number];

type MappingPack = {
  channel: MarketplaceChannel;
  displayName: string;
  requiredFields: string[];
  fieldMap: Record<string, string>;
};

type EffectiveMapping = MappingPack & {
  templateId: string | null;
  templateName: string | null;
  source: "system_pack" | "saved_template";
};

const MAPPING_PACKS: Record<MarketplaceChannel, MappingPack> = {
  amazon: {
    channel: "amazon",
    displayName: "Amazon",
    requiredFields: [
      "title",
      "brand",
      "description",
      "hsnCode",
      "gstRate",
      "attributes.color",
      "attributes.material",
    ],
    fieldMap: {
      title: "item_name",
      brand: "brand_name",
      description: "product_description",
      hsnCode: "hsn_code",
      gstRate: "tax_rate",
      "attributes.color": "color_name",
      "attributes.material": "material_type",
      "attributes.size": "size_name",
    },
  },
  flipkart: {
    channel: "flipkart",
    displayName: "Flipkart",
    requiredFields: [
      "title",
      "brand",
      "description",
      "hsnCode",
      "gstRate",
      "attributes.size",
      "attributes.color",
    ],
    fieldMap: {
      title: "product_title",
      brand: "brand",
      description: "description",
      hsnCode: "hsn_code",
      gstRate: "gst_rate",
      "attributes.size": "size",
      "attributes.color": "color",
      "attributes.material": "material",
    },
  },
  meesho: {
    channel: "meesho",
    displayName: "Meesho",
    requiredFields: ["title", "brand", "hsnCode", "gstRate", "attributes.color"],
    fieldMap: {
      title: "product_name",
      brand: "brand",
      hsnCode: "hsn",
      gstRate: "gst",
      "attributes.color": "color",
      "attributes.material": "fabric",
    },
  },
};

@Injectable()
export class MarketplaceService {
  constructor(private readonly prisma: PrismaService) {}

  listChannels() {
    return MARKETPLACE_CHANNELS.map((channel) => {
      const pack = MAPPING_PACKS[channel];
      return {
        channel,
        displayName: pack.displayName,
        requiredFields: pack.requiredFields,
      };
    });
  }

  async getChannelMapping(channelInput: string, categoryId?: string, templateId?: string) {
    const mapping = await this.getEffectiveMapping(channelInput, categoryId, templateId);
    return {
      channel: mapping.channel,
      displayName: mapping.displayName,
      requiredFields: mapping.requiredFields,
      fieldMap: mapping.fieldMap,
      source: mapping.source,
      templateId: mapping.templateId,
      templateName: mapping.templateName,
    };
  }

  async listTemplates(categoryId: string, channelInput?: string) {
    await this.requireCategory(categoryId);
    const channel = channelInput ? this.parseChannel(channelInput) : undefined;
    return this.prisma.channelMappingTemplate.findMany({
      where: {
        categoryId,
        channel: channel ? (channel as MarketplaceChannelDb) : undefined,
      },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    });
  }

  async createTemplate(categoryId: string, dto: CreateMappingTemplateDto) {
    await this.requireCategory(categoryId);
    const channel = this.parseChannel(dto.channel);
    const requiredFields = this.normalizeRequiredFields(dto.requiredFields);
    const fieldMap = this.normalizeFieldMap(dto.fieldMap);

    if (dto.isDefault) {
      await this.prisma.channelMappingTemplate.updateMany({
        where: { categoryId, channel: channel as MarketplaceChannelDb },
        data: { isDefault: false },
      });
    }

    try {
      return await this.prisma.channelMappingTemplate.create({
        data: {
          categoryId,
          name: dto.name.trim(),
          channel: channel as MarketplaceChannelDb,
          requiredFields: requiredFields as unknown as Prisma.JsonArray,
          fieldMap: fieldMap as unknown as Prisma.JsonObject,
          isDefault: dto.isDefault ?? false,
        },
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new BadRequestException("Template name already exists for this category and channel.");
      }
      throw error;
    }
  }

  async createExportJob(productId: string, dto: CreateExportJobDto) {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException("Product not found");
    }

    const simulation = await this.simulateProduct(productId, dto.channel, dto.templateId);
    return this.prisma.marketplaceExportJob.create({
      data: {
        productId,
        categoryId: product.categoryId,
        channel: simulation.channel as MarketplaceChannelDb,
        templateId: simulation.templateId ?? null,
        status: ExportJobStatus.queued,
        retryCount: 0,
        maxRetries: dto.maxRetries ?? 3,
        payload: {
          mappingSource: simulation.mappingSource,
          missingFields: simulation.missingFields,
          complianceSummary: simulation.complianceSummary,
          mappedPayload: simulation.mappedPayload,
        } as Prisma.JsonObject,
      },
      include: { template: true },
    });
  }

  async listExportJobs(productId?: string) {
    return this.prisma.marketplaceExportJob.findMany({
      where: productId ? { productId } : undefined,
      include: {
        template: true,
        product: { select: { id: true, title: true } },
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 50,
    });
  }

  async getExportJob(jobId: string) {
    const job = await this.prisma.marketplaceExportJob.findUnique({
      where: { id: jobId },
      include: { template: true, product: { select: { id: true, title: true } } },
    });
    if (!job) {
      throw new NotFoundException("Export job not found");
    }
    return job;
  }

  async processExportJob(jobId: string) {
    const existing = await this.prisma.marketplaceExportJob.findUnique({ where: { id: jobId } });
    if (!existing) {
      throw new NotFoundException("Export job not found");
    }
    if (existing.status === ExportJobStatus.completed) {
      return existing;
    }
    if (existing.status === ExportJobStatus.dead_letter) {
      throw new BadRequestException("Job is in DLQ. Requeue before processing.");
    }

    await this.prisma.marketplaceExportJob.update({
      where: { id: jobId },
      data: { status: ExportJobStatus.processing },
    });

    const simulation = await this.simulateProduct(
      existing.productId,
      existing.channel,
      existing.templateId ?? undefined,
    );

    if (simulation.exportReady) {
      return this.prisma.marketplaceExportJob.update({
        where: { id: jobId },
        data: {
          status: ExportJobStatus.completed,
          failureReason: null,
          dlqReason: null,
          exportPayload: simulation.mappedPayload as Prisma.JsonObject,
        },
        include: { template: true },
      });
    }

    const nextRetry = existing.retryCount + 1;
    const failureReason = this.buildFailureReason(simulation.missingFields, simulation.complianceSummary.errorCount);
    if (nextRetry >= existing.maxRetries) {
      return this.prisma.marketplaceExportJob.update({
        where: { id: jobId },
        data: {
          status: ExportJobStatus.dead_letter,
          retryCount: nextRetry,
          failureReason,
          dlqReason: "Max retries exceeded",
          exportPayload: Prisma.JsonNull,
        },
        include: { template: true },
      });
    }

    return this.prisma.marketplaceExportJob.update({
      where: { id: jobId },
      data: {
        status: ExportJobStatus.retrying,
        retryCount: nextRetry,
        failureReason,
        exportPayload: Prisma.JsonNull,
      },
      include: { template: true },
    });
  }

  async requeueExportJob(jobId: string) {
    const existing = await this.prisma.marketplaceExportJob.findUnique({ where: { id: jobId } });
    if (!existing) {
      throw new NotFoundException("Export job not found");
    }
    if (
      existing.status !== ExportJobStatus.dead_letter &&
      existing.status !== ExportJobStatus.retrying &&
      existing.status !== ExportJobStatus.failed
    ) {
      throw new BadRequestException("Only retrying/failed/DLQ jobs can be requeued.");
    }
    return this.prisma.marketplaceExportJob.update({
      where: { id: jobId },
      data: {
        status: ExportJobStatus.queued,
        failureReason: null,
        dlqReason: null,
      },
      include: { template: true },
    });
  }

  async simulateProduct(productId: string, channelInput: string, templateId?: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include: {
        validationIssues: {
          where: { status: ValidationIssueStatus.open },
          orderBy: [{ severity: "desc" }, { createdAt: "desc" }],
        },
      },
    });
    if (!product) {
      throw new NotFoundException("Product not found");
    }

    const mapping = await this.getEffectiveMapping(channelInput, product.categoryId, templateId);
    const attributes = this.asRecord(product.attributes);
    const missingFields = mapping.requiredFields.filter((fieldPath) =>
      this.isEmpty(this.getFieldValue(fieldPath, product, attributes)),
    );

    const channelIssues = missingFields.map((fieldPath) => ({
      severity: "error",
      code: "CHANNEL_REQUIRED_FIELD",
      fieldPath,
      message: `${fieldPath} is required for ${mapping.displayName}.`,
    }));

    const complianceErrors = product.validationIssues.filter(
      (issue) => issue.severity === RuleSeverity.error,
    ).length;
    const complianceWarnings = product.validationIssues.filter(
      (issue) => issue.severity === RuleSeverity.warning,
    ).length;

    const riskScore = Math.min(
      100,
      missingFields.length * 18 + complianceErrors * 25 + complianceWarnings * 8,
    );
    const riskBand = riskScore >= 60 ? "high" : riskScore >= 30 ? "medium" : "low";

    const mappedPayload: Record<string, unknown> = {};
    for (const [sourceField, targetField] of Object.entries(mapping.fieldMap)) {
      const value = this.getFieldValue(sourceField, product, attributes);
      if (!this.isEmpty(value)) {
        mappedPayload[targetField] = value;
      }
    }

    return {
      productId,
      channel: mapping.channel,
      displayName: mapping.displayName,
      exportReady: channelIssues.length === 0 && complianceErrors === 0,
      riskScore,
      riskBand,
      requiredFields: mapping.requiredFields,
      missingFields,
      channelIssues,
      complianceSummary: {
        errorCount: complianceErrors,
        warningCount: complianceWarnings,
      },
      mappingSource: mapping.source,
      templateId: mapping.templateId,
      templateName: mapping.templateName,
      mappedPayload,
      suggestions: missingFields.map((fieldPath) => ({
        fieldPath,
        fix: `Provide ${fieldPath} before publishing to ${mapping.displayName}.`,
      })),
    };
  }

  private async getEffectiveMapping(
    channelInput: string,
    categoryId?: string,
    templateId?: string,
  ): Promise<EffectiveMapping> {
    const channel = this.parseChannel(channelInput);
    const basePack = MAPPING_PACKS[channel];

    if (templateId) {
      const template = await this.prisma.channelMappingTemplate.findUnique({
        where: { id: templateId },
      });
      if (!template) {
        throw new NotFoundException("Mapping template not found");
      }
      if (template.channel !== (channel as MarketplaceChannelDb)) {
        throw new BadRequestException("Template channel mismatch.");
      }
      if (categoryId && template.categoryId !== categoryId) {
        throw new BadRequestException("Template category mismatch.");
      }
      return {
        channel,
        displayName: basePack.displayName,
        requiredFields: this.asStringArray(template.requiredFields),
        fieldMap: this.asStringMap(template.fieldMap),
        templateId: template.id,
        templateName: template.name,
        source: "saved_template",
      };
    }

    if (categoryId) {
      const defaultTemplate = await this.prisma.channelMappingTemplate.findFirst({
        where: {
          categoryId,
          channel: channel as MarketplaceChannelDb,
          isDefault: true,
        },
        orderBy: [{ updatedAt: "desc" }],
      });
      if (defaultTemplate) {
        return {
          channel,
          displayName: basePack.displayName,
          requiredFields: this.asStringArray(defaultTemplate.requiredFields),
          fieldMap: this.asStringMap(defaultTemplate.fieldMap),
          templateId: defaultTemplate.id,
          templateName: defaultTemplate.name,
          source: "saved_template",
        };
      }
    }

    return {
      ...basePack,
      requiredFields: [...basePack.requiredFields],
      fieldMap: { ...basePack.fieldMap },
      templateId: null,
      templateName: null,
      source: "system_pack",
    };
  }

  private parseChannel(channelInput: string): MarketplaceChannel {
    const normalized = String(channelInput ?? "")
      .trim()
      .toLowerCase();
    if ((MARKETPLACE_CHANNELS as readonly string[]).includes(normalized)) {
      return normalized as MarketplaceChannel;
    }
    throw new BadRequestException(
      `Unsupported channel. Allowed values: ${MARKETPLACE_CHANNELS.join(", ")}`,
    );
  }

  private normalizeRequiredFields(fields: string[]) {
    const normalized = fields
      .map((field) => String(field ?? "").trim())
      .filter((field) => field.length > 0);
    if (normalized.length === 0) {
      throw new BadRequestException("requiredFields cannot be empty.");
    }
    return [...new Set(normalized)];
  }

  private normalizeFieldMap(input: Record<string, string>) {
    const normalized: Record<string, string> = {};
    for (const [source, target] of Object.entries(input ?? {})) {
      const sourceKey = source.trim();
      const targetKey = String(target ?? "").trim();
      if (!sourceKey || !targetKey) {
        continue;
      }
      normalized[sourceKey] = targetKey;
    }
    if (Object.keys(normalized).length === 0) {
      throw new BadRequestException("fieldMap cannot be empty.");
    }
    return normalized;
  }

  private asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((item) => (typeof item === "string" ? item.trim() : ""))
      .filter((item) => item.length > 0);
  }

  private asStringMap(value: unknown): Record<string, string> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }
    const out: Record<string, string> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (typeof val === "string") {
        const source = key.trim();
        const target = val.trim();
        if (source && target) {
          out[source] = target;
        }
      }
    }
    return out;
  }

  private buildFailureReason(missingFields: string[], complianceErrorCount: number) {
    const parts: string[] = [];
    if (missingFields.length > 0) {
      parts.push(`Missing required fields: ${missingFields.join(", ")}`);
    }
    if (complianceErrorCount > 0) {
      parts.push(`Compliance errors: ${complianceErrorCount}`);
    }
    return parts.join(" | ") || "Export validation failed";
  }

  private async requireCategory(categoryId: string) {
    const category = await this.prisma.category.findUnique({ where: { id: categoryId } });
    if (!category) {
      throw new NotFoundException("Category not found");
    }
    return category;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private getFieldValue(
    fieldPath: string,
    product: {
      title: string;
      description: string;
      brand: string;
      hsnCode: string | null;
      gstRate: number | null;
      attributes: unknown;
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

  private isEmpty(value: unknown) {
    return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
  }
}
