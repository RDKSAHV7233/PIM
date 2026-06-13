// apps/api/src/connectors/woocommerce/woocommerce-reconciliation.service.ts
//
// W6: pim_wins reconciliation job.
// Runs on a 4-hour interval; fetches each live WooCommerce product and
// compares it against the PIM payload snapshot. On drift, re-publishes
// from PIM (enforcing PIM as source of truth).
//
// Disable via WOO_RECONCILE_DISABLED=true env var.

import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { LoggerService } from '../../common/logging/logger.service';
import { PrismaDirectService } from '../../prisma/prisma-direct.service';
import { WooCommerceConnector } from './woocommerce.connector';
import { ConnectorContext } from '../../connector-framework/connector.interface';

const RECONCILE_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 h
const INITIAL_DELAY_MS      = 90 * 1000;            // 90 s after boot
export const RECONCILE_BATCH_SIZE = 50;             // submissions per installation per tick
const WOO_SLUG = 'woocommerce';

type InstallationRow = {
  id: string;
  tenantKey: string;
  connectorId: string;
};

@Injectable()
export class WooCommerceReconciliationService implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: ReturnType<typeof setTimeout>   | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly connector: WooCommerceConnector,
    private readonly prismaDirect: PrismaDirectService,
    private readonly logger: LoggerService,
  ) {}

  onApplicationBootstrap(): void {
    if (String(process.env['WOO_RECONCILE_DISABLED'] ?? '').trim().toLowerCase() === 'true') {
      this.logger.info('WooCommerce reconciliation disabled via WOO_RECONCILE_DISABLED.');
      return;
    }
    this.timer = setTimeout(() => {
      void this.runReconciliation();
      this.intervalId = setInterval(() => void this.runReconciliation(), RECONCILE_INTERVAL_MS);
    }, INITIAL_DELAY_MS);
  }

  onApplicationShutdown(): void {
    if (this.timer)      clearTimeout(this.timer);
    if (this.intervalId) clearInterval(this.intervalId);
  }

  async runReconciliation(): Promise<void> {
    if (this.running) {
      this.logger.warn('WooCommerce reconciliation already running — skipping tick.');
      return;
    }
    this.running = true;
    let checked = 0, republished = 0, errors = 0;

    try {
      const installations = await this.loadWooInstallations();

      for (const inst of installations) {
        const ctx = this.buildContext(inst);
        const submissions = await this.loadPendingSubmissions(inst.id);

        for (const sub of submissions) {
          try {
            const result = await this.connector.reconcileSubmission(
              ctx,
              sub.externalRef,
              sub.payloadSnapshot as Record<string, unknown>,
            );
            checked++;

            if (result.needsRepublish) {
              this.logger.warn('WooCommerce reconciliation: drift detected — re-publishing', {
                installationId: inst.id,
                externalRef:    sub.externalRef,
                driftedFields:  result.driftedFields,
              });
              const product = this.connector.snapshotToProductPayload(sub.payloadSnapshot as Record<string, unknown>);
              await this.connector.updateProduct(ctx, product, sub.externalRef);
              republished++;
            }
          } catch (err) {
            errors++;
            this.logger.warn('WooCommerce reconciliation: error processing submission', {
              installationId: inst.id,
              externalRef:    sub.externalRef,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
    } finally {
      this.running = false;
      this.logger.info('WooCommerce reconciliation completed.', { checked, republished, errors });
    }
  }

  private async loadWooInstallations(): Promise<InstallationRow[]> {
    const db = this.prismaDirect.getClient();
    const defs = await db.connectorDefinition.findMany({
      where: { slug: WOO_SLUG },
      select: { id: true },
    });
    if (defs.length === 0) return [];
    const wooConnectorIds = defs.map((d: { id: string }) => d.id);

    const rows = await db.connectorInstallation.findMany({
      where: { connectorId: { in: wooConnectorIds }, status: 'ACTIVE' },
      select: { id: true, tenantKey: true, connectorId: true },
      orderBy: { updatedAt: 'asc' },
    });
    return rows as InstallationRow[];
  }

  private async loadPendingSubmissions(
    installationId: string,
  ): Promise<Array<{ externalRef: string; payloadSnapshot: unknown }>> {
    const db = this.prismaDirect.getClient();
    // Only reconcile SUCCESS submissions resolved in the last 48 h to bound the work window.
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
    const rows = await db.connectorSubmission.findMany({
      where: {
        installationId,
        status: 'SUCCESS',
        externalRef: { not: null },
        resolvedAt: { gte: cutoff },
      },
      select: { externalRef: true, payloadSnapshot: true },
      take: RECONCILE_BATCH_SIZE,
      orderBy: { resolvedAt: 'desc' },
    });
    return rows.filter((r: { externalRef: string | null; payloadSnapshot: unknown }) => r.externalRef != null)
      .map((r: { externalRef: string | null; payloadSnapshot: unknown }) => ({
        externalRef: r.externalRef as string,
        payloadSnapshot: r.payloadSnapshot,
      }));
  }

  private buildContext(inst: InstallationRow): ConnectorContext {
    return {
      tenantId:       inst.tenantKey,
      installationId: inst.id,
      connectorId:    inst.connectorId,
      // WooCommerce uses Basic Auth; getAccessToken is never invoked by the connector.
      getAccessToken: async () => { throw new Error('WooCommerce uses Basic Auth; getAccessToken must not be called'); },
    };
  }
}
