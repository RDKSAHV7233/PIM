import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { getTenantKeyFromContext } from "../common/tenant/tenant-context";
import { PrismaService } from "../prisma/prisma.service";
import { CreateOndcMappingDto } from "./dto/create-ondc-mapping.dto";
import { tenantRaw, tenantExecRaw } from "../common/tenant/tenant-raw";

@Injectable()
export class OndcService {
  constructor(private readonly prisma: PrismaService) {}

  listVersions() {
    return [
      { version: "1.2.0", status: "stable" },
      { version: "1.2.5", status: "stable" },
      { version: "1.3.0-beta", status: "preview" },
    ];
  }

  async createMapping(dto: CreateOndcMappingDto) {
    const tenantKey = getTenantKeyFromContext();
    await this.requireCategory(dto.categoryId);

    const id = randomUUID();
    const normalizedRequiredFields = Array.from(
      new Set(
        dto.requiredFields
          .map((field) => String(field ?? "").trim())
          .filter((field) => field.length > 0),
      ),
    );
    if (normalizedRequiredFields.length === 0) {
      throw new BadRequestException("requiredFields cannot be empty.");
    }

    const fieldMap: Record<string, string> = {};
    for (const [key, value] of Object.entries(dto.fieldMap ?? {})) {
      const source = String(key ?? "").trim();
      const target = String(value ?? "").trim();
      if (source && target) {
        fieldMap[source] = target;
      }
    }
    if (Object.keys(fieldMap).length === 0) {
      throw new BadRequestException("fieldMap cannot be empty.");
    }

    if (dto.isDefault) {
      await tenantExecRaw(this.prisma.tenant(), `
        UPDATE ondc_mappings
        SET is_default = FALSE, updated_at = NOW()
        WHERE tenant_key = $1
          AND node_type = $2
          AND version = $3
          AND category_id = $4
        `, [tenantKey, dto.nodeType, dto.version, dto.categoryId]);
    }

    await tenantExecRaw(this.prisma.tenant(), `
      INSERT INTO ondc_mappings (
        id, tenant_key, name, category_id, node_type, version, required_fields, field_map, discovery_metadata, is_default
      ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb, $10)
      `,
      [id,
      tenantKey,
      dto.name.trim(),
      dto.categoryId,
      dto.nodeType,
      dto.version.trim(),
      JSON.stringify(normalizedRequiredFields),
      JSON.stringify(fieldMap),
      JSON.stringify(dto.discoveryMetadata ?? {}),
      dto.isDefault ?? false]);

    return this.getMapping(id);
  }

  async listMappings(nodeType?: string, version?: string, categoryId?: string) {
    const tenantKey = getTenantKeyFromContext();
    return tenantRaw(this.prisma.tenant(), `
      SELECT
        id,
        name,
        category_id AS "categoryId",
        node_type AS "nodeType",
        version,
        required_fields AS "requiredFields",
        field_map AS "fieldMap",
        discovery_metadata AS "discoveryMetadata",
        is_default AS "isDefault",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM ondc_mappings
      WHERE tenant_key = $1
        AND ($2::text IS NULL OR node_type = $2)
        AND ($3::text IS NULL OR version = $3)
        AND ($4::text IS NULL OR category_id = $4)
      ORDER BY is_default DESC, updated_at DESC
      LIMIT 200
      `,
      [tenantKey, nodeType ?? null, version ?? null, categoryId ?? null]);
  }

  async getMapping(mappingId: string) {
    const tenantKey = getTenantKeyFromContext();
    const rows = (await tenantRaw<Array<Record<string, unknown>>>(this.prisma.tenant(), `
      SELECT
        id,
        name,
        category_id AS "categoryId",
        node_type AS "nodeType",
        version,
        required_fields AS "requiredFields",
        field_map AS "fieldMap",
        discovery_metadata AS "discoveryMetadata",
        is_default AS "isDefault",
        created_at AS "createdAt",
        updated_at AS "updatedAt"
      FROM ondc_mappings
      WHERE tenant_key = $1
        AND id = $2
      LIMIT 1
      `,
      [tenantKey, mappingId]));
    if (rows.length === 0) {
      throw new NotFoundException("ONDC mapping not found");
    }
    return rows[0];
  }

  async simulateProduct(productId: string, nodeType: string, version: string, mappingId?: string) {
    const product = await this.prisma.tenant().product.findUnique({
      where: { id: productId },
      include: { category: true },
    });
    if (!product) {
      throw new NotFoundException("Product not found");
    }

    const mapping = mappingId
      ? await this.getMapping(mappingId)
      : await this.getDefaultMapping(product.categoryId, nodeType, version);
    const requiredFields = this.asStringArray(mapping.requiredFields);
    const fieldMap = this.asStringMap(mapping.fieldMap);
    const attributes = this.asRecord(product.attributes);

    const payload: Record<string, unknown> = {};
    for (const [source, target] of Object.entries(fieldMap)) {
      const value = this.resolveFieldValue(source, product, attributes);
      if (value !== null && value !== undefined && !(typeof value === "string" && value.trim() === "")) {
        payload[target] = value;
      }
    }
    payload.ondcVersion = mapping.version;
    payload.nodeType = mapping.nodeType;
    payload.discovery = mapping.discoveryMetadata;

    const missingFields = requiredFields.filter((field) => {
      const value = this.resolveFieldValue(field, product, attributes);
      return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
    });

    return {
      productId,
      categoryId: product.categoryId,
      nodeType: mapping.nodeType,
      version: mapping.version,
      mappingId: mapping.id,
      discoveryMetadata: mapping.discoveryMetadata,
      publishReady: missingFields.length === 0,
      missingFields,
      payload,
    };
  }

  private async getDefaultMapping(categoryId: string, nodeType: string, version: string) {
    const tenantKey = getTenantKeyFromContext();
    const rows = (await tenantRaw<Array<Record<string, unknown>>>(this.prisma.tenant(), `
      SELECT
        id,
        name,
        category_id AS "categoryId",
        node_type AS "nodeType",
        version,
        required_fields AS "requiredFields",
        field_map AS "fieldMap",
        discovery_metadata AS "discoveryMetadata",
        is_default AS "isDefault"
      FROM ondc_mappings
      WHERE tenant_key = $1
        AND category_id = $2
        AND node_type = $3
        AND version = $4
      ORDER BY is_default DESC, updated_at DESC
      LIMIT 1
      `,
      [tenantKey, categoryId, nodeType, version]));

    if (rows.length === 0) {
      throw new NotFoundException("No ONDC mapping found for category/node/version.");
    }
    return rows[0];
  }

  private async requireCategory(categoryId: string) {
    const category = await this.prisma.tenant().category.findUnique({ where: { id: categoryId } });
    if (!category) {
      throw new NotFoundException("Category not found");
    }
    return category;
  }

  private asStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .map((item) => String(item ?? "").trim())
      .filter((item) => item.length > 0);
  }

  private asStringMap(value: unknown): Record<string, string> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {};
    }
    const out: Record<string, string> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      const source = key.trim();
      const target = String(raw ?? "").trim();
      if (source && target) {
        out[source] = target;
      }
    }
    return out;
  }

  private asRecord(value: unknown): Record<string, unknown> {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    return {};
  }

  private resolveFieldValue(
    source: string,
    product: { title: string; description: string; brand: string; hsnCode: string | null; gstRate: number | null },
    attributes: Record<string, unknown>,
  ) {
    if (source.startsWith("attributes.")) {
      return attributes[source.replace("attributes.", "")];
    }
    const direct = product as unknown as Record<string, unknown>;
    return direct[source];
  }
}

