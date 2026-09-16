// apps/api/src/connectors/woocommerce/woocommerce-brownfield-import.service.ts
// W8: brownfield re-link — scan existing WooCommerce products, match to PIM variants,
// and create ConnectorSubmission rows so reconciliation (W6) and bulk publish (W7)
// treat them as already-published.
//
// Match precedence:
//   1. _vexa_pim_product_id meta_data key → look up Variant by skuCode
//   2. WC sku field → look up Variant by skuCode (fallback for pre-Vexa products)
//
// Idempotent: re-running creates no duplicate submissions (upsert by idempotencyKey).

import { randomUUID } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import type { ConnectorContext } from '../../connector-framework/connector.interface';
import { PrismaDirectService } from '../../prisma/prisma-direct.service';
import { WooCommerceConnector } from './woocommerce.connector';

export type BrownfieldImportResult = {
  linked: number;         // matched via _vexa_pim_product_id meta_data
  skuLinked: number;      // matched via WC sku fallback
  unmatched: number;      // WC product with no SKU match in PIM
  total: number;          // total WC products scanned
};

@Injectable()
export class WooCommerceBrownfieldImportService {
  private readonly logger = new Logger(WooCommerceBrownfieldImportService.name);

  /** Products fetched per WooCommerce API page call. */
  static readonly BROWNFIELD_PAGE_SIZE = 100;

  constructor(
    private readonly connector: WooCommerceConnector,
    private readonly prismaDirect: PrismaDirectService,
  ) {}

  /**
   * Scan all products in a WooCommerce installation and link them to PIM products.
   *
   * Paginates GET /products until all pages are consumed.
   * For each WC product: primary match by _vexa_pim_product_id meta_data → skuCode lookup.
   *   Falls back to WC sku field if the meta key is absent.
   * Matched products get a SUCCESS ConnectorSubmission row with externalRef = WC product id.
   */
  async importExistingProducts(
    ctx: ConnectorContext,
    installationId: string,
    tenantKey: string,
  ): Promise<BrownfieldImportResult> {
    const db = this.prismaDirect.getClient();
    let linked = 0;
    let skuLinked = 0;
    let unmatched = 0;
    let total = 0;

    let page = 1;
    let totalPages = 1;

    while (page <= totalPages) {
      const { items, totalPages: tp } = await this.connector.listProductsPage(
        ctx,
        page,
        WooCommerceBrownfieldImportService.BROWNFIELD_PAGE_SIZE,
      );
      totalPages = tp;
      total += items.length;

      for (const item of items) {
        const wcId = item.id != null ? String(item.id) : null;
        if (!wcId) {
          // Can't be matched or submitted without a WC id — count it as unmatched so
          // `total` stays equal to `linked + skuLinked + unmatched` (previously this
          // dropped out of every bucket, so total could technically exceed their sum).
          unmatched++;
          continue;
        }

        // Primary match: _vexa_pim_product_id meta_data key (written by W2)
        const vexaSkuMeta = item.meta_data?.find((m) => m.key === '_vexa_pim_product_id');
        const vexaSku = vexaSkuMeta ? String(vexaSkuMeta.value ?? '').trim() : null;
        const wcSku    = item.sku ? String(item.sku).trim() : null;

        const lookupSku = vexaSku || wcSku;
        if (!lookupSku) {
          unmatched++;
          continue;
        }

        const variant = await db.variant.findFirst({
          where: { tenantKey, skuCode: lookupSku },
          select: { id: true, productId: true },
        });

        if (!variant) {
          unmatched++;
          continue;
        }

        const idempotencyKey = `woo:pub:${variant.productId}`;
        const now = new Date();

        await db.connectorSubmission.upsert({
          where: {
            tenantKey_installationId_idempotencyKey: { tenantKey, installationId, idempotencyKey },
          },
          create: {
            id: randomUUID(),
            tenantKey,
            installationId,
            productId: variant.productId,
            idempotencyKey,
            submissionType: 'PUBLISH',
            source: 'BROWNFIELD',
            attemptNumber: 1,
            status: 'SUCCESS',
            externalRef: wcId,
            payloadSnapshot: {},
            channelErrors: [],
            submittedAt: now,
            resolvedAt: now,
          },
          update: {
            status: 'SUCCESS',
            externalRef: wcId,
            resolvedAt: now,
          },
        });

        if (vexaSku) {
          linked++;
        } else {
          skuLinked++;
        }
      }

      page++;

      // Guard against malformed totalPages (e.g. 0 from an empty store)
      if (totalPages === 0 || items.length === 0) break;
    }

    this.logger.log('woocommerce.brownfield_import.complete', {
      installationId,
      total,
      linked,
      skuLinked,
      unmatched,
    });
    return { linked, skuLinked, unmatched, total };
  }
}
