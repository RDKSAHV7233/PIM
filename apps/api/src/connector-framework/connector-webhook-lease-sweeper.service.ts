import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { runWithAdvisoryLock } from "../common/scheduling/advisory-lock";
import { PrismaDirectService } from "../prisma/prisma-direct.service";
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

export type WebhookLeaseSweepSummary = {
  scanned: number;
  processed: number;
  failed: number;
  retried: number;
  skipped: number;
};

@Injectable()
export class ConnectorWebhookLeaseSweeperService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConnectorWebhookLeaseSweeperService.name);
  private initialTimeout: NodeJS.Timeout | null = null;
  private intervalHandle: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prismaDirect: PrismaDirectService,
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
    }, SWEEP_INITIAL_DELAY_MS);
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
    };

    if (this.running) {
      this.logger.warn("Connector webhook lease sweep already running — skipping tick.");
      return summary;
    }
    this.running = true;

    try {
      const client = this.prismaDirect.getClient();
      const now = new Date();
      const batchSize = options.batchSize ?? this.batchSize();
      const maxAttempts = options.maxAttempts ?? this.maxAttempts();

      // Column order matches idx_connector_webhooks_recovery
      // (tenant_key, processing_status, processing_lease_until, received_at).
      const stranded = await client.connectorWebhookEvent.findMany({
        where: {
          ...(options.tenantKey ? { tenantKey: options.tenantKey } : {}),
          processingStatus: { in: ["received", "processing"] },
          processingLeaseUntil: { lt: now },
        },
        select: { id: true, tenantKey: true, installationId: true },
        orderBy: { receivedAt: "asc" },
        take: batchSize,
      });

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
