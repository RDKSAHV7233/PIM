import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from "@nestjs/common";
import { BulkEditOperationStatus, Prisma, RecordStatus } from "@prisma/client";
import { AccessPolicyService, PolicyActor } from "../common/access-policy/access-policy.service";
import { ComplianceService } from "../compliance/compliance.service";
import {
  CursorPaginationQuery,
  decodeCursorToken,
  encodeCursorToken,
  isCursorPagination,
  resolveCursorLimit,
} from "../common/pagination/cursor-pagination";
import { getTenantKeyFromContext, runWithTenantContext } from "../common/tenant/tenant-context";
import { normalizeTenantKey } from "../common/tenant/tenant.constants";
import { PrismaService } from "../prisma/prisma.service";
import { QUEUE_NAMES } from "../queue/queue.constants";
import { QueueService } from "../queue/queue.service";
import { BulkEditScopeDto } from "./dto/bulk-edit-scope.dto";
import { isValidWorkflowTransition } from "../common/workflow/workflow-transitions";

const RECORD_STATUSES = ["draft", "in_review", "approved", "rejected", "active", "archived"] as const;
const EDITABLE_FIELDS = ["title", "description", "brand", "status", "hsnCode", "gstRate"] as const;
type EditableField = (typeof EDITABLE_FIELDS)[number];

function mergeWhere<T extends Record<string, unknown>>(left: T | undefined, right: T | undefined): T | undefined {
  if (left && right) {
    return { AND: [left, right] } as unknown as T;
  }
  return left ?? right;
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
  version: number;
};

type NormalizedUpdates = {
  title?: string;
  description?: string;
  brand?: string;
  status?: RecordStatus;
  hsnCode?: string | null;
  gstRate?: number | null;
};

type BulkEditApplyJobPayload = {
  operationId: string;
  tenantKey: string;
  actor: PolicyActor;
};

// CTO review remediation (CODE-004): apply() used to load up to 10,000
// products and process them inline with Promise.allSettled in the HTTP
// request handler — synchronous, capped, and not resumable. apply() now
// only creates the operation and enqueues one job; APPLY_BATCH_SIZE bounds
// how many products the queue handler loads per DB round trip while it
// works through however many products actually matched (uncapped).
const APPLY_BATCH_SIZE = 500;

@Injectable()
export class BulkEditService implements OnModuleInit {
  private readonly logger = new Logger(BulkEditService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly complianceService: ComplianceService,
    private readonly accessPolicy: AccessPolicyService,
    private readonly queueService: QueueService,
  ) {}

  onModuleInit(): void {
    this.queueService.processWithBackpressure<BulkEditApplyJobPayload>(
      QUEUE_NAMES.BULK_EDIT,
      { laneResolver: (payload) => payload.tenantKey },
      async (payload) => {
        try {
          await runWithTenantContext(payload.tenantKey, () => this.processApplyJob(payload));
        } catch (error) {
          this.logger.error(
            `Bulk edit operation ${payload.operationId} failed unexpectedly: ${error instanceof Error ? error.message : String(error)}`,
          );
          await runWithTenantContext(payload.tenantKey, async () => {
            try {
              await this.prisma.tenant().bulkEditOperation.update({
                where: { id: payload.operationId },
                data: { status: BulkEditOperationStatus.failed },
              });
            } catch {
              this.logger.error(`Failed to mark operation ${payload.operationId} as failed.`);
            }
          });
          throw error;
        }
      },
    );
  }

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

  /**
   * Validates the request, creates the operation record, and enqueues one
   * job — the request handler no longer waits for the actual product
   * updates. See processApplyJob() for the queued work.
   */
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

    const requestedCount = await this.prisma.tenant().product.count({ where });

    const operation = await this.prisma.tenant().bulkEditOperation.create({
      data: {
        status: requestedCount > 0 ? BulkEditOperationStatus.queued : BulkEditOperationStatus.completed,
        scope: normalizedScope as Prisma.JsonObject,
        updates: normalizedUpdates as Prisma.JsonObject,
        requestedCount,
      },
    });

    if (requestedCount === 0) {
      return operation;
    }

    const tenantKey = normalizeTenantKey(getTenantKeyFromContext());
    await this.queueService.enqueue<BulkEditApplyJobPayload>(QUEUE_NAMES.BULK_EDIT, {
      operationId: operation.id,
      tenantKey,
      actor: actor ?? {},
    });

    return operation;
  }

  /**
   * Queue handler for a single bulk-edit operation. Idempotent and
   * resumable: on redelivery (worker crash, transient DB error mid-run) it
   * skips products already recorded in BulkEditOperationItem for this
   * operation and continues from where it left off, instead of re-applying
   * updates or double-counting results.
   */
  private async processApplyJob(payload: BulkEditApplyJobPayload): Promise<void> {
    const operation = await this.prisma.tenant().bulkEditOperation.findUnique({
      where: { id: payload.operationId },
    });
    if (!operation) {
      this.logger.warn(`Bulk edit operation ${payload.operationId} not found — skipping.`);
      return;
    }
    if (operation.status !== BulkEditOperationStatus.queued && operation.status !== BulkEditOperationStatus.processing) {
      // Already terminal (completed/completed_with_errors/failed) — redelivery no-op.
      return;
    }
    if (operation.status === BulkEditOperationStatus.queued) {
      await this.prisma.tenant().bulkEditOperation.update({
        where: { id: operation.id },
        data: { status: BulkEditOperationStatus.processing },
      });
    }

    const scope = operation.scope as {
      categoryId?: string;
      status?: RecordStatus;
      brandContains?: string;
      productIds?: string[];
    };
    const normalizedUpdates = operation.updates as NormalizedUpdates;
    const where = mergeWhere(
      this.buildWhere(scope),
      await this.accessPolicy.buildProductScopeWhere(payload.actor, "edit"),
    );
    const updateData = this.toUpdateData(normalizedUpdates);

    const alreadyProcessedIds = new Set(
      (
        await this.prisma.tenant().bulkEditOperationItem.findMany({
          where: { operationId: operation.id },
          select: { productId: true },
        })
      )
        .map((item) => item.productId)
        .filter((id): id is string => Boolean(id)),
    );

    let cursor: string | undefined;
    for (;;) {
      const batch = await this.prisma.tenant().product.findMany({
        where,
        // Stable id-ascending cursor — updatedAt (used by preview()'s sample
        // ordering) would shift under us as each batch's writes touch it,
        // corrupting cursor pagination mid-run.
        orderBy: [{ id: "asc" }],
        take: APPLY_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: this.productSelect,
      });
      if (batch.length === 0) {
        break;
      }
      cursor = batch[batch.length - 1]!.id;

      for (const product of batch) {
        if (alreadyProcessedIds.has(product.id)) {
          continue;
        }
        await this.applyToProduct(operation.id, product, updateData, normalizedUpdates, payload.actor);
      }

      if (batch.length < APPLY_BATCH_SIZE) {
        break;
      }
    }

    await this.finalizeOperation(operation.id);
  }

  private async applyToProduct(
    operationId: string,
    product: ProductSnapshot,
    updateData: Prisma.ProductUpdateInput,
    normalizedUpdates: NormalizedUpdates,
    actor: PolicyActor,
  ): Promise<void> {
    const before = this.toSnapshot(product);
    try {
      await this.accessPolicy.assertRequestedProductScopeAllowed(actor, "edit", {
        resource: "BulkEditOperation",
        resourceId: product.id,
        categoryId: product.categoryId,
        brand: normalizedUpdates.brand ?? product.brand,
      });
      if (normalizedUpdates.status && !isValidWorkflowTransition(product.status, normalizedUpdates.status)) {
        throw new BadRequestException(
          `Invalid workflow transition from ${product.status} to ${normalizedUpdates.status}.`,
        );
      }
      // Optimistic concurrency, matching catalog.service.ts's updateProduct(): bulk edit
      // batches load a snapshot of matching products, then process each one individually,
      // so a single-product PATCH (or another bulk edit) can land on this row in between.
      // Without this check the later write would silently clobber it and `version` would
      // never move, so no caller — this one included — could ever detect the collision (#559).
      const updateResult = await this.prisma.tenant().product.updateMany({
        where: { id: product.id, version: product.version },
        data: { ...updateData, version: { increment: 1 } },
      });
      if (updateResult.count === 0) {
        const latest = await this.prisma.tenant().product.findUnique({
          where: { id: product.id },
          select: { version: true },
        });
        throw new ConflictException(
          `Skipped: product was changed by another operation after this bulk edit started ` +
            `(had version ${product.version}, now ${latest?.version ?? "unknown — product may have been archived or deleted"}). ` +
            `Reload and retry if this update still applies.`,
        );
      }
      const updated = await this.prisma.tenant().product.findUniqueOrThrow({
        where: { id: product.id },
        select: this.productSelect,
      });

      await this.complianceService.validateAndPersistProduct(updated.id);

      await this.prisma.tenant().bulkEditOperationItem.create({
        data: {
          operationId,
          productId: updated.id,
          status: "success",
          before: before as Prisma.JsonObject,
          after: this.toSnapshot(updated) as Prisma.JsonObject,
        },
      });
    } catch (error: unknown) {
      await this.prisma.tenant().bulkEditOperationItem.create({
        data: {
          operationId,
          productId: product.id,
          status: "failed",
          before: before as Prisma.JsonObject,
          errorMessage: this.extractErrorMessage(error),
        },
      });
    }
  }

  /**
   * Recomputes appliedCount/failedCount from BulkEditOperationItem via
   * groupBy (same pattern as bulk-import's refreshJobCounters) instead of
   * accumulating in-memory counters — safe across resumed/redelivered runs
   * where a prior partial attempt already wrote some items.
   */
  private async finalizeOperation(operationId: string): Promise<void> {
    const statusGroups = await this.prisma.tenant().bulkEditOperationItem.groupBy({
      by: ["status"],
      where: { operationId },
      _count: { status: true },
    });

    let appliedCount = 0;
    let failedCount = 0;
    for (const group of statusGroups) {
      if (group.status === "success") {
        appliedCount = group._count.status;
      } else if (group.status === "failed") {
        failedCount = group._count.status;
      }
    }

    const status =
      failedCount > 0 && appliedCount === 0
        ? BulkEditOperationStatus.failed
        : failedCount > 0
          ? BulkEditOperationStatus.completed_with_errors
          : BulkEditOperationStatus.completed;

    await this.prisma.tenant().bulkEditOperation.update({
      where: { id: operationId },
      data: { status, appliedCount, failedCount },
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

  async getOperation(operationId: string, itemsPagination?: { cursor?: string; limit?: number }) {
    const operation = await this.prisma.tenant().bulkEditOperation.findUnique({
      where: { id: operationId },
    });
    if (!operation) {
      throw new NotFoundException("Bulk edit operation not found");
    }
    const limit = Math.min(Math.max(itemsPagination?.limit ?? 100, 1), 500);
    const cursorId = itemsPagination?.cursor;
    const items = await this.prisma.tenant().bulkEditOperationItem.findMany({
      where: {
        operationId,
        ...(cursorId ? { id: { lt: cursorId } } : {}),
      },
      orderBy: [{ id: "desc" }],
      take: limit + 1,
    });
    const hasNext = items.length > limit;
    const pageItems = hasNext ? items.slice(0, limit) : items;
    return {
      ...operation,
      items: pageItems,
      itemsNextCursor: hasNext ? pageItems[pageItems.length - 1]?.id ?? null : null,
    };
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
    version: true,
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
    version: number;
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
      version: product.version,
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
