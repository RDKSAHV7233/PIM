// apps/api/src/connectors/woocommerce/woocommerce-bulk-publish.service.ts
// W7: per-installation bulk publish with 100-item batching and checkpoint-based resumability.
// Checkpoint key: `woo:pub:{productId}` — any prior SUCCESS submission for the same
// (tenantKey, installationId, productId) is treated as published and skipped on re-run.
// W2 idempotent upsert (_vexa_pim_product_id) ensures safe re-calls even without the checkpoint.

import { randomUUID } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { ConnectorContext, ProductPayload } from '../../connector-framework/connector.interface';
import { PrismaDirectService } from '../../prisma/prisma-direct.service';
import { WooCommerceConnector } from './woocommerce.connector';

export type BulkPublishItem = {
  productId: string;   // PIM product UUID — stored in ConnectorSubmission.productId
  payload: ProductPayload;
};

export type BulkPublishResult = {
  success: number;
  failed: number;
  skipped: number;
};

@Injectable()
export class WooCommerceBulkPublishService {
  private readonly logger = new Logger(WooCommerceBulkPublishService.name);

  /** Products processed per concurrent batch; each batch fans out internally. */
  static readonly BULK_BATCH_SIZE = 100;

  constructor(
    private readonly connector: WooCommerceConnector,
    private readonly prismaDirect: PrismaDirectService,
  ) {}

  /**
   * Publish a list of products to a WooCommerce installation in batches of BULK_BATCH_SIZE.
   *
   * Resumable: items with an existing SUCCESS submission for
   *   (tenantKey, installationId, `woo:pub:{productId}`) are skipped automatically.
   *
   * Fault-isolated: one item failure does not abort the rest of its batch.
   * All batches run sequentially; items within a batch run concurrently.
   */
  async executeBulkPublish(
    ctx: ConnectorContext,
    installationId: string,
    tenantKey: string,
    products: ReadonlyArray<BulkPublishItem>,
  ): Promise<BulkPublishResult> {
    const db = this.prismaDirect.getClient();
    let success = 0;
    let failed = 0;
    let skipped = 0;

    for (let i = 0; i < products.length; i += WooCommerceBulkPublishService.BULK_BATCH_SIZE) {
      const batch = products.slice(i, i + WooCommerceBulkPublishService.BULK_BATCH_SIZE);

      await Promise.all(
        batch.map(async ({ productId, payload }) => {
          const idempotencyKey = `woo:pub:${productId}`;

          // Checkpoint: skip products already published successfully to this installation.
          const existing = await db.connectorSubmission.findFirst({
            where: { tenantKey, installationId, idempotencyKey, status: 'SUCCESS' },
            select: { id: true },
          });
          if (existing) {
            skipped++;
            return;
          }

          try {
            const ref = await this.connector.publishProduct(ctx, payload);
            const now = new Date();
            await db.connectorSubmission.upsert({
              where: {
                tenantKey_installationId_idempotencyKey: { tenantKey, installationId, idempotencyKey },
              },
              create: {
                id: randomUUID(),
                tenantKey,
                installationId,
                productId,
                idempotencyKey,
                submissionType: 'PUBLISH',
                source: 'BULK',
                attemptNumber: 1,
                status: 'SUCCESS',
                externalRef: ref.externalRef || null,
                payloadSnapshot: {},
                channelErrors: [],
                submittedAt: now,
                resolvedAt: now,
              },
              update: {
                status: 'SUCCESS',
                externalRef: ref.externalRef || null,
                attemptNumber: { increment: 1 },
                resolvedAt: now,
              },
            });
            success++;
          } catch (err) {
            this.logger.warn('woocommerce.bulk_publish.item_failed', {
              installationId,
              productId,
              reason: err instanceof Error ? err.message : String(err),
            });
            failed++;
          }
        }),
      );
    }

    this.logger.log('woocommerce.bulk_publish.complete', {
      installationId,
      total: products.length,
      success,
      failed,
      skipped,
    });
    return { success, failed, skipped };
  }
}
