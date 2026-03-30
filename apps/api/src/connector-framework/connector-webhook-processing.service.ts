import { Injectable } from "@nestjs/common";
import { LoggerService } from "../common/logging/logger.service";
import { QUEUE_NAMES } from "../queue/queue.constants";
import { QueueService } from "../queue/queue.service";
import {
  ConnectorWebhookIngestionService,
  type IngestConnectorWebhookResult,
} from "./connector-webhook-ingestion.service";

export type ConnectorWebhookQueuePayload = {
  tenantKey: string;
  installationId: string;
  rawBodyBase64: string;
  headers: Record<string, string>;
};

@Injectable()
export class ConnectorWebhookProcessingService {
  constructor(
    private readonly queueService: QueueService,
    private readonly ingestionService: ConnectorWebhookIngestionService,
    private readonly logger: LoggerService,
  ) {
    this.registerWorker();
  }

  async enqueue(payload: ConnectorWebhookQueuePayload, options?: { delayMs?: number }): Promise<void> {
    await this.queueService.enqueue(QUEUE_NAMES.CONNECTOR_WEBHOOK, payload, options);
  }

  private registerWorker(): void {
    this.queueService.processWithBackpressure<ConnectorWebhookQueuePayload>(
      QUEUE_NAMES.CONNECTOR_WEBHOOK,
      {
        laneResolver: (payload) => String(payload.installationId ?? "default"),
        defaultLanePolicy: {
          concurrency: 1,
          minIntervalMs: 100,
          rateLimitFailureThreshold: 3,
          pauseDurationMs: 30_000,
        },
      },
      async (payload) => {
        await this.processQueuedWebhook(payload);
      },
    );
  }

  private async processQueuedWebhook(
    payload: ConnectorWebhookQueuePayload,
  ): Promise<IngestConnectorWebhookResult> {
    const rawBody = Buffer.from(String(payload.rawBodyBase64 ?? ""), "base64");
    const result = await this.ingestionService.ingest({
      tenantKey: String(payload.tenantKey ?? "").trim(),
      installationId: String(payload.installationId ?? "").trim(),
      rawBody,
      headers: payload.headers ?? {},
    });

    this.logger.info("Connector webhook queue job processed", {
      tenantKey: payload.tenantKey,
      installationId: payload.installationId,
      accepted: result.accepted,
      duplicate: result.duplicate,
      eventId: result.eventId ?? null,
      eventType: result.eventType ?? null,
      submissionId: result.submissionId ?? null,
      status: result.status ?? null,
      reason: result.reason ?? null,
    });

    return result;
  }
}
