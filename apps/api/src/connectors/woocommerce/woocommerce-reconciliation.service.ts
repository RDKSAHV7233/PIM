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
import { runWithAdvisoryLock } from '../../common/scheduling/advisory-lock';
import { forEachTenant } from '../../common/tenant/tenant-iteration';
import { PrismaDirectService } from '../../prisma/prisma-direct.service';
import { WooCommerceConnector } from './woocommerce.connector';
import { ConnectorContext } from '../../connector-framework/connector.interface';

const RECONCILE_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4 h
const INITIAL_DELAY_MS      = 90 * 1000;            // 90 s after boot
export const RECONCILE_BATCH_SIZE = 50;             // submissions per installation per tick
const WOO_SLUG = 'woocommerce';

/** WOO_RECONCILE_INITIAL_DELAY_MS (>= 100) shortens the first run for tests; unset or invalid keeps 90 seconds. */
function resolveInitialDelayMs(env: NodeJS.ProcessEnv = process.env): number {
  const requested = Number(env['WOO_RECONCILE_INITIAL_DELAY_MS']);
  return Number.isFinite(requested) && requested >= 100 ? Math.floor(requested) : INITIAL_DELAY_MS;
}

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
      void this.runScheduledReconciliation();
      this.intervalId = setInterval(() => void this.runScheduledReconciliation(), RECONCILE_INTERVAL_MS);
    }, resolveInitialDelayMs());
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
        let submissions: Array<{ externalRef: string; payloadSnapshot: unknown }>;
        try {
          submissions = await this.loadPendingSubmissions(inst);
        } catch (err) {
          // One installation whose submissions cannot be read must not stop the others; it is counted and logged by code.
          errors++;
          this.logger.warn('WooCommerce reconciliation: could not read an installation\'s submissions', {
            installationId: inst.id,
            tenantKey:      inst.tenantKey,
            error:          err instanceof Error ? err.message : String(err),
          });
          continue;
        }

        for (const sub of submissions) {
          try {
            const result = await this.connector.reconcileSubmission(
              ctx,
              sub.externalRef,
              sub.payloadSnapshot as Record<string, unknown>,
            );
            checked++;

            if (result.providerReadUnavailable) {
              errors++;
              this.logger.warn('WooCommerce reconciliation: provider read unavailable — drift status blocked', {
                installationId: inst.id,
                externalRef:    sub.externalRef,
                providerStatus: result.providerReadStatus ?? null,
              });
              continue;
            }

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

  private async runScheduledReconciliation(): Promise<void> {
    let ran = false;
    try {
      ran = await runWithAdvisoryLock('woocommerce-reconciliation', async () => {
        try {
          await this.runReconciliation();
        } catch (error: unknown) {
          this.logger.warn('WooCommerce reconciliation scheduled run failed open.', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    } catch (error: unknown) {
      this.logger.error('Scheduler lock failure for woocommerce-reconciliation.', {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    if (!ran) {
      this.logger.info('Skipped WooCommerce reconciliation: another replica holds the scheduler lock.');
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

    // SEC-DB-RLS-001: this used to be ONE read through the context-free client, which under row level security sees no tenant's
    // installations, so the job that enforces PIM as the source of truth against live WooCommerce drift would have checked
    // nothing while reporting a clean tick. It now reads per tenant (forEachTenant: one transaction per tenant, tenant context set
    // inside it) and the query ALSO filters by the tenant it is given, so it is correct whether or not the role bypasses RLS.
    // The connector catalogue (connector_definitions) is not row-level-secured and stays on the context-free client. A tenant that
    // cannot be read is logged as an error by code and the readable tenants are still reconciled. Order is unchanged (least
    // recently updated first), now across tenants.
    const found: Array<InstallationRow & { updatedAt: Date }> = [];
    const discovery = await forEachTenant(db, async (tx, tenantKey) => {
      const rows = await tx.connectorInstallation.findMany({
        where: { tenantKey, connectorId: { in: wooConnectorIds }, status: 'ACTIVE' },
        select: { id: true, tenantKey: true, connectorId: true, updatedAt: true },
        orderBy: { updatedAt: 'asc' },
      });
      // A row of another tenant means the filter above was bypassed: count it as a failure, never act on it.
      const own = rows.filter((row: { tenantKey: string }) => row.tenantKey === tenantKey);
      found.push(...own);
      return { examinedCount: rows.length, changedCount: 0, failedCount: rows.length - own.length };
    });
    if (discovery.tenantsFailed > 0) {
      this.logger.error('WooCommerce reconciliation could not read some tenants; their installations were NOT reconciled this tick.', {
        tenantsFailed:    discovery.tenantsFailed,
        tenantsEvaluated: discovery.tenantsEvaluated,
        failures: discovery.results
          .filter((result) => result.status === 'failed')
          .map((result) => ({ tenantKey: result.tenantKey, errorCode: result.errorCode ?? 'UNKNOWN' })),
      });
    }
    return found
      .sort((x, y) => new Date(x.updatedAt).getTime() - new Date(y.updatedAt).getTime() || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
      .map(({ id, tenantKey, connectorId }) => ({ id, tenantKey, connectorId }));
  }

  private async loadPendingSubmissions(
    inst: InstallationRow,
  ): Promise<Array<{ externalRef: string; payloadSnapshot: unknown }>> {
    // Submissions are row-level-secured: read them inside the installation's own tenant transaction. A failed read throws so the
    // caller counts it, instead of treating an unreadable tenant as having nothing to reconcile.
    const db = this.prismaDirect.getClient();
    // Only reconcile SUCCESS submissions resolved in the last 48 h to bound the work window.
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
    let rows: Array<{ externalRef: string | null; payloadSnapshot: unknown }> = [];
    const read = await forEachTenant(
      db,
      async (tx) => {
        rows = await tx.connectorSubmission.findMany({
          where: {
            tenantKey: inst.tenantKey,
            installationId: inst.id,
            status: 'SUCCESS',
            externalRef: { not: null },
            resolvedAt: { gte: cutoff },
          },
          select: { externalRef: true, payloadSnapshot: true },
          take: RECONCILE_BATCH_SIZE,
          orderBy: { resolvedAt: 'desc' },
        });
        return { examinedCount: rows.length, changedCount: 0 };
      },
      { tenantKeys: [inst.tenantKey] },
    );
    if (read.tenantsFailed > 0) {
      throw new Error(`submissions not readable (${read.results[0]?.errorCode ?? 'UNKNOWN'})`);
    }
    return rows
      .filter((r) => r.externalRef != null)
      .map((r) => ({ externalRef: r.externalRef as string, payloadSnapshot: r.payloadSnapshot }));
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
