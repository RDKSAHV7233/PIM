import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { runWithAdvisoryLock } from "../common/scheduling/advisory-lock";
import { forEachTenant } from "../common/tenant/tenant-iteration";
import { PrismaService } from "../prisma/prisma.service";
import { ConnectorWebhookIngestionService } from "./connector-webhook-ingestion.service";

/**
 * Connector-webhook processing-lease sweeper.
 *
 * The webhook remediation added a processing lease to connector_webhook_events
 * (processing_status / processing_lease_until / processing_attempt_count, plus
 * idx_connector_webhooks_recovery). Recovery was redelivery-driven only: if a
 * worker crashed mid-processing and the connector never re-sent the event, the
 * row stayed in 'received' / 'processing' forever and idx_connector_webhooks_recovery
 * was read by nobody.
 *
 * This service closes that gap. On a timer it selects rows whose lease has
 * expired (processing_status IN ('received','processing') AND
 * processing_lease_until < now()) and asks the ingestion service to re-drive
 * each through the same processReservedWebhookEvent() step the live pipeline
 * uses, bumping processing_attempt_count and parking the row in terminal
 * 'failed' + last_error once the attempt cap is hit.
 *
 * Lifecycle mirrors ErrorAuthorityRetentionService /
 * ExportJobReconciliationService: OnModuleInit/OnModuleDestroy, an initial
 * delay, setInterval(...).unref(), a scheduler advisory lock so only one
 * replica runs a tick, and a public runSweep() that is directly testable.
 */

const SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 min
const SWEEP_INITIAL_DELAY_MS = 2 * 60 * 1000; // 2 min after boot
const DEFAULT_BATCH_SIZE = 100;
const DEFAULT_MAX_ATTEMPTS = 5;

/** CONNECTOR_WEBHOOK_LEASE_SWEEP_INITIAL_DELAY_MS (>= 100) shortens the first sweep for tests; unset or invalid keeps 2 minutes. */
function resolveInitialDelayMs(env: NodeJS.ProcessEnv = process.env): number {
  const requested = Number(env["CONNECTOR_WEBHOOK_LEASE_SWEEP_INITIAL_DELAY_MS"]);
  return Number.isFinite(requested) && requested >= 100 ? Math.floor(requested) : SWEEP_INITIAL_DELAY_MS;
}

type StrandedRow = { id: string; tenantKey: string; installationId: string; receivedAt: Date };

export type WebhookLeaseSweepSummary = {
  scanned: number;
  processed: number;
  failed: number;
  retried: number;
  skipped: number;
  tenantsEvaluated: number;
  /** Tenants whose stranded events could not be read this run; their events were NOT evaluated. */
  tenantsFailed: number;
  /** A runtime role cannot see tenants missing from the directory, so this is never reported as zero. */
  orphanDetection: "UNVERIFIED_BY_RUNTIME_ROLE";
};

@Injectable()
export class ConnectorWebhookLeaseSweeperService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConnectorWebhookLeaseSweeperService.name);
  private initialTimeout: NodeJS.Timeout | null = null;
  private intervalHandle: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ingestion: ConnectorWebhookIngestionService,
  ) {}

  onModuleInit(): void {
    if (this.isDisabled()) {
      this.logger.log(
        "Connector webhook lease sweeper disabled via CONNECTOR_WEBHOOK_LEASE_SWEEP_DISABLED.",
      );
      return;
    }
    this.logger.log(
      `Connector webhook lease sweeper scheduled (interval ${SWEEP_INTERVAL_MS}ms, ` +
        `batch ${this.batchSize()}, max attempts ${this.maxAttempts()}).`,
    );
    this.initialTimeout = setTimeout(() => {
      void this.runScheduledSweep();
      this.intervalHandle = setInterval(() => void this.runScheduledSweep(), SWEEP_INTERVAL_MS);
      this.intervalHandle.unref();
    }, resolveInitialDelayMs());
    this.initialTimeout.unref();
  }

  onModuleDestroy(): void {
    if (this.initialTimeout) {
      clearTimeout(this.initialTimeout);
      this.initialTimeout = null;
    }
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /**
   * Scan for stranded webhook rows (expired processing lease) and re-drive each.
   * The scheduled path calls this tenant-agnostically; `options.tenantKey` scopes
   * the scan for deterministic tests.
   */
  async runSweep(options: {
    tenantKey?: string;
    batchSize?: number;
    maxAttempts?: number;
  } = {}): Promise<WebhookLeaseSweepSummary> {
    const summary: WebhookLeaseSweepSummary = {
      scanned: 0,
      processed: 0,
      failed: 0,
      retried: 0,
      skipped: 0,
      tenantsEvaluated: 0,
      tenantsFailed: 0,
      orphanDetection: "UNVERIFIED_BY_RUNTIME_ROLE",
    };

    if (this.running) {
      this.logger.warn("Connector webhook lease sweep already running — skipping tick.");
      return summary;
    }
    this.running = true;

    try {
      const now = new Date();
      const batchSize = options.batchSize ?? this.batchSize();
      const maxAttempts = options.maxAttempts ?? this.maxAttempts();

      // SEC-DB-RLS-001: this used to be ONE cross-tenant read through the context-free direct client, which under row level
      // security sees no tenant's rows, so stranded events would have stayed stranded while the sweep found nothing to do. It now
      // scans per tenant (forEachTenant), inside that tenant's own transaction, and the query ALSO filters by the tenant it is
      // given, so it is correct whether or not the runtime role bypasses RLS. A tenant that could not be read is reported, never
      // skipped silently. Per-tenant results are merged oldest-first under the batch bound. `options.tenantKey` scopes the sweep to
      // one tenant (deterministic tests). The re-drive itself is unchanged and already runs under the event's own tenant.
      const found: StrandedRow[] = [];
      const discovery = await forEachTenant(
        this.prisma.tenant(),
        async (tx, tenantKey) => {
          // Column order matches idx_connector_webhooks_recovery (tenant_key, processing_status, processing_lease_until, received_at).
          // RLS-BYPASS: manual tenant filter — WHERE tenant_key = ${tenantKey} below, on a transaction whose tenant context is that tenant.
          const rows = await tx.$queryRaw<StrandedRow[]>(Prisma.sql`
            SELECT id, tenant_key AS "tenantKey", installation_id AS "installationId", received_at AS "receivedAt"
            FROM connector_webhook_events
            WHERE tenant_key = ${tenantKey}
              AND processing_status IN ('received', 'processing')
              AND processing_lease_until < ${now}
            ORDER BY received_at ASC
            LIMIT ${batchSize}
          `);
          // A row of another tenant means the filter above was bypassed: count it as a failure, never act on it.
          const own = rows.filter((row) => row.tenantKey === tenantKey);
          found.push(...own);
          return { examinedCount: rows.length, changedCount: 0, failedCount: rows.length - own.length };
        },
        options.tenantKey ? { tenantKeys: [options.tenantKey] } : {},
      );
      summary.tenantsEvaluated = discovery.tenantsEvaluated;
      summary.tenantsFailed = discovery.tenantsFailed;
      if (discovery.tenantsFailed > 0) {
        // A tenant we could not read is a tenant whose stranded events we may have missed: an error, never a quiet success.
        this.logger.error(
          `Connector webhook lease sweep could not read ${discovery.tenantsFailed}/${discovery.tenantsEvaluated} tenant(s) [${discovery.results
            .filter((result) => result.status === "failed")
            .map((result) => `${result.tenantKey}:${result.errorCode ?? "UNKNOWN"}`)
            .join(", ")}]; their stranded events were NOT evaluated this run.`,
        );
      }
      const stranded = found
        .sort((x, y) => new Date(x.receivedAt).getTime() - new Date(y.receivedAt).getTime())
        .slice(0, batchSize);
      summary.scanned = stranded.length;
      if (stranded.length === 0) {
        this.logger.log("Connector webhook lease sweep: no stranded events.");
        return summary;
      }
      this.logger.log(
        `Connector webhook lease sweep: ${stranded.length} stranded event(s) found; re-driving.`,
      );

      for (const row of stranded) {
        try {
          const result = await this.ingestion.redriveStrandedWebhookEvent({
            id: row.id,
            tenantKey: row.tenantKey,
            installationId: row.installationId,
            maxAttempts,
          });
          switch (result.outcome) {
            case "processed":
              summary.processed++;
              break;
            case "failed":
              summary.failed++;
              break;
            case "retry":
              summary.retried++;
              break;
            default:
              summary.skipped++;
          }
        } catch (error: unknown) {
          summary.skipped++;
          this.logger.error(
            `Connector webhook lease sweep: re-drive failed for ${row.id}: ` +
              `${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }

      this.logger.log(
        `Connector webhook lease sweep complete: scanned=${summary.scanned} ` +
          `processed=${summary.processed} failed=${summary.failed} ` +
          `retried=${summary.retried} skipped=${summary.skipped}.`,
      );
      return summary;
    } finally {
      this.running = false;
    }
  }

  private async runScheduledSweep(): Promise<void> {
    let ran = false;
    try {
      ran = await runWithAdvisoryLock("connector-webhook-lease-sweep", async () => {
        try {
          await this.runSweep();
        } catch (error: unknown) {
          this.logger.error(
            `Connector webhook lease sweep scheduled run failed: ` +
              `${error instanceof Error ? error.message : String(error)}`,
          );
        }
      });
    } catch (error: unknown) {
      this.logger.error(
        `Scheduler lock failure for connector-webhook-lease-sweep: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      return;
    }
    if (!ran) {
      this.logger.debug(
        "Skipped connector webhook lease sweep: another replica holds the scheduler lock.",
      );
    }
  }

  private isDisabled(): boolean {
    return (
      String(process.env["CONNECTOR_WEBHOOK_LEASE_SWEEP_DISABLED"] ?? "")
        .trim()
        .toLowerCase() === "true"
    );
  }

  private batchSize(): number {
    const raw = Number(process.env["CONNECTOR_WEBHOOK_LEASE_SWEEP_BATCH_SIZE"] ?? DEFAULT_BATCH_SIZE);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_BATCH_SIZE;
  }

  private maxAttempts(): number {
    const raw = Number(process.env["CONNECTOR_WEBHOOK_LEASE_MAX_ATTEMPTS"] ?? DEFAULT_MAX_ATTEMPTS);
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX_ATTEMPTS;
  }
}
