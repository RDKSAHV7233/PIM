import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma, RecordStatus } from "@prisma/client";
import { AccessPolicyService, PolicyActor } from "../common/access-policy/access-policy.service";
import { ComplianceService } from "../compliance/compliance.service";
import {
  CursorPaginationQuery,
  decodeCursorToken,
  encodeCursorToken,
  isCursorPagination,
  resolveCursorLimit,
} from "../common/pagination/cursor-pagination";
import { PrismaService } from "../prisma/prisma.service";
import { BulkEditScopeDto } from "./dto/bulk-edit-scope.dto";

const RECORD_STATUSES = ["draft", "in_review", "approved", "rejected", "active", "archived"] as const;
const EDITABLE_FIELDS = ["title", "description", "brand", "status", "hsnCode", "gstRate"] as const;
type EditableField = (typeof EDITABLE_FIELDS)[number];
type WorkflowStatus = "draft" | "in_review" | "approved" | "rejected" | "archived";

const WORKFLOW_TRANSITIONS: Record<WorkflowStatus, readonly WorkflowStatus[]> = {
  draft: ["in_review", "archived"],
  in_review: ["approved", "rejected", "draft", "archived"],
  approved: ["archived"],
  rejected: ["draft", "in_review", "archived"],
  archived: ["draft", "in_review"],
};

function mergeWhere<T extends Record<string, unknown>>(left: T | undefined, right: T | undefined): T | undefined {
  if (left && right) {
    return { AND: [left, right] } as unknown as T;
  }
  return left ?? right;
}

function canonicalWorkflowStatus(status: RecordStatus): WorkflowStatus {
  if (status === RecordStatus.active) {
    return "approved";
  }
  return status as WorkflowStatus;
}

function isValidStatusTransition(currentStatus: RecordStatus, nextStatus: RecordStatus): boolean {
  if (currentStatus === nextStatus) {
    return true;
  }
  const currentCanonical = canonicalWorkflowStatus(currentStatus);
  const nextCanonical = canonicalWorkflowStatus(nextStatus);
  if (currentCanonical === nextCanonical) {
    return true;
  }
  const allowed = WORKFLOW_TRANSITIONS[currentCanonical] ?? [];
  return allowed.includes(nextCanonical);
}

type ProductSnapshot = {
  id: string;
  title: string;
  description: string;
  brand: string;
  status: RecordStatus;
  hsnCode: string | null;
  gstRate: number | null;
  categoryId: string;
};

type NormalizedUpdates = {
  title?: string;
  description?: string;
  brand?: string;
  status?: RecordStatus;
  hsnCode?: string | null;
  gstRate?: number | null;
};

@Injectable()
export class BulkEditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly complianceService: ComplianceService,
    private readonly accessPolicy: AccessPolicyService,
  ) {}

  async preview(scope: BulkEditScopeDto, updatesInput: Record<string, unknown>, actor?: PolicyActor) {
    const normalizedScope = this.normalizeScope(scope);
    this.ensureNonEmptyScope(normalizedScope);
    const normalizedUpdates = this.normalizeUpdates(updatesInput);
    if (normalizedScope.categoryId) {
      await this.accessPolicy.assertCategoryAccess(actor ?? {}, "bulk_edit", normalizedScope.categoryId, "BulkEditOperation");
    }
    await this.accessPolicy.assertBulkEditAllowed(actor ?? {}, {
      fields: Object.keys(normalizedUpdates),
    });
    await this.assertExplicitProductIdsAllowed(normalizedScope.productIds, actor ?? {}, "bulk_edit");
    const where = mergeWhere(
      this.buildWhere(normalizedScope),
      await this.accessPolicy.buildProductScopeWhere(actor ?? {}, "edit"),
    );

    const [requestedCount, sample] = await Promise.all([
      this.prisma.tenant().product.count({ where }),
      this.prisma.tenant().product.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }],
        take: 25,
        select: this.productSelect,
      }),
    ]);

    return {
      scope: normalizedScope,
      updates: normalizedUpdates,
      requestedCount,
      sampleCount: sample.length,
      sample,
    };
  }

  async apply(scope: BulkEditScopeDto, updatesInput: Record<string, unknown>, actor?: PolicyActor) {
    const normalizedScope = this.normalizeScope(scope);
    this.ensureNonEmptyScope(normalizedScope);
    const normalizedUpdates = this.normalizeUpdates(updatesInput);
    if (normalizedScope.categoryId) {
      await this.accessPolicy.assertCategoryAccess(actor ?? {}, "bulk_edit", normalizedScope.categoryId, "BulkEditOperation");
    }
    await this.accessPolicy.assertBulkEditAllowed(actor ?? {}, {
      fields: Object.keys(normalizedUpdates),
    });
    await this.assertExplicitProductIdsAllowed(normalizedScope.productIds, actor ?? {}, "bulk_edit");
    const where = mergeWhere(
      this.buildWhere(normalizedScope),
      await this.accessPolicy.buildProductScopeWhere(actor ?? {}, "edit"),
    );
    const updateData = this.toUpdateData(normalizedUpdates);

    const products = await this.prisma.tenant().product.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      select: this.productSelect,
      take: 10_000, // defensive cap — prevents full-table scan for category-scoped edits
    });

    const operation = await this.prisma.tenant().bulkEditOperation.create({
      data: {
        status: "processing",
        scope: normalizedScope as Prisma.JsonObject,
        updates: normalizedUpdates as Prisma.JsonObject,
        requestedCount: products.length,
      },
    });

    // Parallel product updates — each product is independent (distinct productId).
    // With the compliance cache warm after the first product (same categoryId across
    // all products in a bulk edit), per-product DB cost is ~3 writes.
    // Promise.allSettled so one product failure doesn't abort the rest.
    const outcomes = await Promise.allSettled(
      products.map(async (product) => {
        const before = this.toSnapshot(product);
        try {
          await this.accessPolicy.assertRequestedProductScopeAllowed(
            actor ?? {},
            "edit",
            {
              resource: "BulkEditOperation",
              resourceId: product.id,
              categoryId: product.categoryId,
              brand: normalizedUpdates.brand ?? product.brand,
            },
          );
          if (normalizedUpdates.status && !isValidStatusTransition(product.status, normalizedUpdates.status)) {
            throw new BadRequestException(
              `Invalid workflow transition from ${product.status} to ${normalizedUpdates.status}.`,
            );
          }
          const updated = await this.prisma.tenant().product.update({
            where: { id: product.id },
            data: updateData,
            select: this.productSelect,
          });

          await this.complianceService.validateAndPersistProduct(updated.id);

          await this.prisma.tenant().bulkEditOperationItem.create({
            data: {
              operationId: operation.id,
              productId: updated.id,
              status: "success",
              before: before as Prisma.JsonObject,
              after: this.toSnapshot(updated) as Prisma.JsonObject,
            },
          });
          return "success" as const;
        } catch (error: unknown) {
          await this.prisma.tenant().bulkEditOperationItem.create({
            data: {
              operationId: operation.id,
              productId: product.id,
              status: "failed",
              before: before as Prisma.JsonObject,
              errorMessage: this.extractErrorMessage(error),
            },
          });
          return "failed" as const;
        }
      }),
    );

    const appliedCount = outcomes.filter(
      (r) => r.status === "fulfilled" && r.value === "success",
    ).length;
    const failedCount = outcomes.filter(
      (r) => r.status === "rejected" || (r.status === "fulfilled" && r.value === "failed"),
    ).length;

    const status = failedCount > 0 && appliedCount === 0 ? "failed" : "completed";

    return this.prisma.tenant().bulkEditOperation.update({
      where: { id: operation.id },
      data: {
        status,
        appliedCount,
        failedCount,
      },
      include: {
        items: {
          orderBy: [{ createdAt: "desc" }],
        },
      },
    });
  }

  async listOperations(limit = 20, pagination?: CursorPaginationQuery) {
    if (isCursorPagination(pagination)) {
      const safeLimit = resolveCursorLimit(pagination?.limit);
      const token = decodeCursorToken(pagination?.cursor);
      if (pagination?.cursor && !token) {
        throw new BadRequestException("Invalid cursor.");
      }
      const cursorDate = token ? new Date(token.sort) : null;
      if (token && (!cursorDate || Number.isNaN(cursorDate.getTime()))) {
        throw new BadRequestException("Invalid cursor.");
      }
      const rows = await this.prisma.tenant().bulkEditOperation.findMany({
        where: token && cursorDate
          ? {
              OR: [
                { createdAt: { lt: cursorDate } },
                {
                  createdAt: cursorDate,
                  id: { lt: token.id },
                },
              ],
            }
          : undefined,
        take: safeLimit + 1,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        include: {
          items: {
            take: 100,
            orderBy: [{ createdAt: "desc" }],
          },
        },
      });
      const hasNext = rows.length > safeLimit;
      const items = hasNext ? rows.slice(0, safeLimit) : rows;
      const last = items[items.length - 1];
      return {
        items,
        limit: safeLimit,
        nextCursor: hasNext && last
          ? encodeCursorToken({
              sort: last.createdAt.toISOString(),
              id: last.id,
            })
          : null,
      };
    }
    const safeLimit = Number.isFinite(limit) ? Math.max(1, Math.min(50, Math.floor(limit))) : 20;
    return this.prisma.tenant().bulkEditOperation.findMany({
      take: safeLimit,
      orderBy: [{ createdAt: "desc" }],
      include: {
        items: {
          take: 100,
          orderBy: [{ createdAt: "desc" }],
        },
      },
    });
  }

  async getOperation(operationId: string) {
    const operation = await this.prisma.tenant().bulkEditOperation.findUnique({
      where: { id: operationId },
      include: {
        items: {
          orderBy: [{ createdAt: "desc" }],
        },
      },
    });
    if (!operation) {
      throw new NotFoundException("Bulk edit operation not found");
    }
    return operation;
  }

  private readonly productSelect = {
    id: true,
    title: true,
    description: true,
    brand: true,
    status: true,
    hsnCode: true,
    gstRate: true,
    categoryId: true,
  } satisfies Prisma.ProductSelect;

  private normalizeScope(scope?: BulkEditScopeDto) {
    const input = scope ?? {};
    const productIds = Array.from(
      new Set((input.productIds ?? []).map((id) => String(id).trim()).filter((id) => id.length > 0)),
    );

    const normalized: {
      categoryId?: string;
      status?: RecordStatus;
      brandContains?: string;
      productIds?: string[];
    } = {};

    if (input.categoryId?.trim()) {
      normalized.categoryId = input.categoryId.trim();
    }

    if (input.status) {
      if (!RECORD_STATUSES.includes(input.status)) {
        throw new BadRequestException("Invalid scope status value.");
      }
      normalized.status = input.status;
    }

    if (input.brandContains?.trim()) {
      normalized.brandContains = input.brandContains.trim();
    }

    if (productIds.length > 0) {
      normalized.productIds = productIds;
    }

    return normalized;
  }

  private ensureNonEmptyScope(scope: {
    categoryId?: string;
    status?: RecordStatus;
    brandContains?: string;
    productIds?: string[];
  }) {
    const hasProductIds = Array.isArray(scope.productIds) && scope.productIds.length > 0;
    if (!scope.categoryId && !scope.status && !scope.brandContains && !hasProductIds) {
      throw new BadRequestException({
        code: "EMPTY_SCOPE",
        message: "Bulk edit scope must include at least one selector (productIds, categoryId, status, or brand).",
      });
    }
  }

  private normalizeUpdates(updatesInput: Record<string, unknown>): NormalizedUpdates {
    if (!updatesInput || typeof updatesInput !== "object" || Array.isArray(updatesInput)) {
      throw new BadRequestException("updates must be a JSON object.");
    }

    const updates: NormalizedUpdates = {};

    for (const [key, rawValue] of Object.entries(updatesInput)) {
      if (!EDITABLE_FIELDS.includes(key as EditableField)) {
        throw new BadRequestException(`Unsupported bulk edit field: ${key}`);
      }

      switch (key as EditableField) {
        case "title": {
          const value = String(rawValue ?? "").trim();
          if (!value) {
            throw new BadRequestException("title cannot be empty.");
          }
          updates.title = value;
          break;
        }
        case "description": {
          const value = String(rawValue ?? "").trim();
          if (!value) {
            throw new BadRequestException("description cannot be empty.");
          }
          updates.description = value;
          break;
        }
        case "brand": {
          const value = String(rawValue ?? "").trim();
          if (!value) {
            throw new BadRequestException("brand cannot be empty.");
          }
          updates.brand = value;
          break;
        }
        case "status": {
          const value = String(rawValue ?? "").trim();
          if (!RECORD_STATUSES.includes(value as RecordStatus)) {
            throw new BadRequestException(
              "status must be one of draft, in_review, approved, rejected, active, or archived.",
            );
          }
          updates.status = value as RecordStatus;
          break;
        }
        case "hsnCode": {
          if (rawValue === null || rawValue === undefined) {
            updates.hsnCode = null;
            break;
          }
          const value = String(rawValue).trim();
          updates.hsnCode = value.length > 0 ? value : null;
          break;
        }
        case "gstRate": {
          if (rawValue === null || rawValue === undefined || String(rawValue).trim() === "") {
            updates.gstRate = null;
            break;
          }
          const value = Number(rawValue);
          if (!Number.isFinite(value) || value < 0) {
            throw new BadRequestException("gstRate must be a non-negative number or null.");
          }
          updates.gstRate = value;
          break;
        }
      }
    }

    if (Object.keys(updates).length === 0) {
      throw new BadRequestException("At least one supported update field is required.");
    }

    return updates;
  }

  private toUpdateData(updates: NormalizedUpdates): Prisma.ProductUpdateInput {
    const data: Prisma.ProductUpdateInput = {};

    if (updates.title !== undefined) {
      data.title = updates.title;
    }
    if (updates.description !== undefined) {
      data.description = updates.description;
    }
    if (updates.brand !== undefined) {
      data.brand = updates.brand;
    }
    if (updates.status !== undefined) {
      data.status = updates.status;
    }
    if (updates.hsnCode !== undefined) {
      data.hsnCode = updates.hsnCode;
    }
    if (updates.gstRate !== undefined) {
      data.gstRate = updates.gstRate;
    }

    return data;
  }

  private buildWhere(scope: {
    categoryId?: string;
    status?: RecordStatus;
    brandContains?: string;
    productIds?: string[];
  }): Prisma.ProductWhereInput {
    const where: Prisma.ProductWhereInput = {};

    if (scope.categoryId) {
      where.categoryId = scope.categoryId;
    }

    if (scope.status) {
      where.status = scope.status;
    }

    if (scope.brandContains) {
      where.brand = {
        contains: scope.brandContains,
        mode: "insensitive",
      };
    }

    if (scope.productIds && scope.productIds.length > 0) {
      where.id = {
        in: scope.productIds,
      };
    }

    return where;
  }

  private toSnapshot(product: {
    id: string;
    title: string;
    description: string;
    brand: string;
    status: RecordStatus;
    hsnCode: string | null;
    gstRate: number | null;
    categoryId: string;
  }): ProductSnapshot {
    return {
      id: product.id,
      title: product.title,
      description: product.description,
      brand: product.brand,
      status: product.status,
      hsnCode: product.hsnCode,
      gstRate: product.gstRate,
      categoryId: product.categoryId,
    };
  }

  private extractErrorMessage(error: unknown) {
    if (error instanceof Error) {
      return error.message;
    }
    return "Unknown bulk edit error";
  }

  private async assertExplicitProductIdsAllowed(
    productIds: string[] | undefined,
    actor: PolicyActor,
    action: "bulk_edit",
  ) {
    if (!productIds || productIds.length === 0) {
      return;
    }
    const allowedWhere = await this.accessPolicy.buildProductScopeWhere(actor, "edit");
    if (!allowedWhere) {
      return;
    }
    const count = await this.prisma.tenant().product.count({
      where: mergeWhere(
        {
          id: {
            in: productIds,
          },
        },
        allowedWhere,
      ),
    });
    if (count !== productIds.length) {
      await this.accessPolicy.assertRequestedProductScopeAllowed(
        actor,
        action,
        {
          resource: "BulkEditOperation",
          resourceId: productIds.join(","),
          categoryId: null,
          brand: null,
        },
      );
    }
  }
}
