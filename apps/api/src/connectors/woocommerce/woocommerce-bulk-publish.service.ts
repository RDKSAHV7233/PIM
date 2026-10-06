// apps/api/src/connectors/woocommerce/woocommerce-bulk-publish.service.ts
// W7: per-installation bulk publish with 100-item batching and checkpoint-based resumability.
// Checkpoint key: `woo:pub:{productId}` — any prior SUCCESS submission for the same
// (tenantKey, installationId, productId) is treated as published and skipped on re-run.
// W2 idempotent upsert (_vexa_pim_product_id) ensures safe re-calls even without the checkpoint.
//
// PIM P1 WooCommerce review: the checkpoint used to be read-then-write (a plain
// findFirst() followed later by an upsert()), which is a genuine TOCTOU race —
// two overlapping executeBulkPublish runs for the same installation (a
// double-submitted "Publish all" click, or a retried job racing a still-running
// one) could both see "no existing SUCCESS row" for the same productId and both
// call connector.publishProduct() concurrently. publishProduct()'s own
// findExistingProductId() SKU lookup has the identical race, so two concurrent
// calls for the same SKU can both decide "create" and create two WooCommerce
// products for one PIM product — exactly the duplicate-creation class of bug
// already found and fixed in the Odoo connector this sprint (PR #935), just via
// a different code path (no existence check there; here the checkpoint's own
// check-then-act window). Fixed by claiming the checkpoint atomically via
// INSERT ... ON CONFLICT ... WHERE (the same idiom woocommerce.connector.ts's
// handleOAuthCallback() already uses for its own tenant-ownership guard): a
// second concurrent claim attempt for the same (tenantKey, installationId,
// idempotencyKey) affects zero rows and is skipped instead of racing through.
// A failed publish releases the claim (deletes the row) so the next run can
// retry it, matching the pre-fix behaviour where a failed attempt left no
// row behind at all.

import { randomUUID } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { ConnectorContext, ProductPayload } from '../../connector-framework/connector.interface';
import { PrismaDirectService } from '../../prisma/prisma-direct.service';
import { PrismaService } from '../../prisma/prisma.service';
import { tenantDb } from '../../connector-framework/tenant-db';
import { tenantExecRaw } from '../../common/tenant/tenant-raw';
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
    // SEC-DB-RLS-001 M1b: the tenant client for known-tenant reads and writes; optional only so tests that build this by hand are unchanged.
    private readonly prisma?: PrismaService,
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
    const db = tenantDb(this.prisma, this.prismaDirect, tenantKey);
    let success = 0;
    let failed = 0;
    let skipped = 0;

    for (let i = 0; i < products.length; i += WooCommerceBulkPublishService.BULK_BATCH_SIZE) {
      const batch = products.slice(i, i + WooCommerceBulkPublishService.BULK_BATCH_SIZE);

      await Promise.all(
        batch.map(async ({ productId, payload }) => {
          const idempotencyKey = `woo:pub:${productId}`;

          // Checkpoint: atomically claim (tenantKey, installationId, idempotencyKey) before
          // publishing. A plain findFirst()-then-upsert() (the pre-fix version of this method)
          // is a check-then-act race: two overlapping bulk-publish runs could both see "not
          // published yet" for the same productId and both call publishProduct() concurrently,
          // which can create two WooCommerce products for one PIM product (findExistingProductId()
          // has the identical SKU-lookup race inside publishProduct() itself). The INSERT ...
          // ON CONFLICT ... WHERE below only claims the row when no SUCCESS or in-flight PENDING
          // row already exists, so a losing concurrent claim affects zero rows and is skipped
          // instead of racing through to a duplicate create.
          const claimedRows = await tenantExecRaw(
            db,
            `
            INSERT INTO connector_submissions (
              id, tenant_key, installation_id, product_id, idempotency_key,
              submission_type, source, attempt_number, status, external_ref,
              payload_snapshot, channel_errors, submitted_at, resolved_at
            ) VALUES (
              $1, $2, $3, $4, $5, 'PUBLISH', 'BULK', 1, 'PENDING', NULL, '{}'::jsonb, '[]'::jsonb, NOW(), NULL
            )
            ON CONFLICT (tenant_key, installation_id, idempotency_key) DO UPDATE SET
              status = 'PENDING',
              submitted_at = NOW(),
              resolved_at = NULL
            WHERE connector_submissions.tenant_key = EXCLUDED.tenant_key
              AND connector_submissions.status NOT IN ('SUCCESS', 'PENDING')
            `,
            [randomUUID(), tenantKey, installationId, productId, idempotencyKey],
          );

          if (claimedRows === 0) {
            // Either already published (SUCCESS) or another concurrent run currently holds
            // the claim (PENDING) — either way, this run does not attempt it.
            skipped++;
            return;
          }

          try {
            const ref = await this.connector.publishProduct(ctx, payload);
            await db.connectorSubmission.update({
              where: {
                tenantKey_installationId_idempotencyKey: { tenantKey, installationId, idempotencyKey },
              },
              data: {
                status: 'SUCCESS',
                externalRef: ref.externalRef || null,
                attemptNumber: { increment: 1 },
                resolvedAt: new Date(),
              },
            });
            success++;
          } catch (err) {
            this.logger.warn('woocommerce.bulk_publish.item_failed', {
              installationId,
              productId,
              reason: err instanceof Error ? err.message : String(err),
            });
            // Release the claim so a future run retries this item, matching the pre-fix
            // behaviour where a failed attempt left no checkpoint row behind at all.
            await db.connectorSubmission.deleteMany({
              where: { tenantKey, installationId, idempotencyKey, status: 'PENDING' },
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
