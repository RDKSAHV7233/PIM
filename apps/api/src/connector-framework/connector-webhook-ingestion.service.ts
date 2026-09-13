import { Injectable, NotFoundException } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { LoggerService } from "../common/logging/logger.service";
import { PrismaService } from "../prisma/prisma.service";
import { ConnectorRegistry } from "./connector.registry";
import { ConnectorIssue, ParsedWebhookEvent } from "./connector.interface";
import { tenantRaw } from "../common/tenant/tenant-raw";

type ConnectorInstallationLookup = {
  id: string;
  slug: string;
  tenantKey: string;
};

type SubmissionLookup = {
  id: string;
};

type WebhookReservation = {
  id: string;
  duplicate: boolean;
  reason?: "processed" | "in_progress";
};

const WEBHOOK_PROCESSING_LEASE_MS = 5 * 60 * 1000;
const WEBHOOK_PROCESSING_STATUS_RECEIVED = "received";
const WEBHOOK_PROCESSING_STATUS_PROCESSING = "processing";
const WEBHOOK_PROCESSING_STATUS_PROCESSED = "processed";
const WEBHOOK_PROCESSING_STATUS_FAILED = "failed";
const WEBHOOK_ERROR_MESSAGE_LIMIT = 1_000;

export type RedriveStrandedWebhookInput = {
  id: string;
  tenantKey: string;
  installationId: string;
  maxAttempts: number;
};

export type RedriveStrandedWebhookOutcome = "processed" | "failed" | "retry" | "skipped";

export type IngestConnectorWebhookInput = {
  tenantKey: string;
  installationId: string;
  rawBody: Buffer;
  headers: Record<string, string>;
};

export type IngestConnectorWebhookResult = {
  accepted: boolean;
  duplicate: boolean;
  eventId?: string;
  eventType?: string;
  submissionId?: string | null;
  status?: string | null;
  reason?: string | null;
};

@Injectable()
export class ConnectorWebhookIngestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ConnectorRegistry,
    private readonly logger: LoggerService,
  ) {}

  async ingest(input: IngestConnectorWebhookInput): Promise<IngestConnectorWebhookResult> {
    const installation = await this.requireInstallation(input.tenantKey, input.installationId);
    const connector = this.registry.getConnector(installation.slug);
    if (!connector.parseWebhookEvent) {
      return {
        accepted: false,
        duplicate: false,
        reason: `connector '${installation.slug}' does not support webhook parsing`,
      };
    }

    // Security contract enforcement: connectors with WEBHOOK_RECEIVE must verify
    // HMAC signatures in parseWebhookEvent. If requiresWebhookSignatureVerification
    // is explicitly false, that is an unusual configuration requiring a documented
    // alternative control (e.g. IP allowlisting). Emit a startup-time warning so
    // it doesn't silently accept unverified payloads.
    if (
      connector.capabilities.includes("WEBHOOK_RECEIVE") &&
      connector.requiresWebhookSignatureVerification === false
    ) {
      this.logger.warn("connector.webhook.signature_verification_disabled", {
        slug: installation.slug,
        installationId: input.installationId,
        note: "This connector has WEBHOOK_RECEIVE but requiresWebhookSignatureVerification=false. " +
              "Ensure an alternative control (e.g. IP allowlisting) is documented and active.",
      });
    }

    const parsedEvent = await connector.parseWebhookEvent(
      input.rawBody,
      input.headers,
      { tenantId: input.tenantKey, installationId: input.installationId },
    );
    if (!parsedEvent) {
      this.logger.warn("connector.webhook.rejected", {
        slug: installation.slug,
        tenantKey: input.tenantKey,
        installationId: input.installationId,
        reason: "invalid_signature_or_payload",
      });
      return {
        accepted: false,
        duplicate: false,
        reason: "invalid_signature_or_payload",
      };
    }

    const reservation = await this.reserveWebhookEvent(
      input.tenantKey,
      input.installationId,
      parsedEvent,
      input.rawBody,
    );
    if (reservation.duplicate) {
      return {
        accepted: true,
        duplicate: true,
        eventId: parsedEvent.rawEventId,
        eventType: parsedEvent.eventType,
        submissionId: null,
        status: parsedEvent.status ?? null,
        reason: reservation.reason ?? "duplicate_event",
      };
    }

    let submissionId: string | null = null;
    try {
      submissionId = await this.processReservedWebhookEvent(
        input.tenantKey,
        input.installationId,
        reservation.id,
        parsedEvent,
      );
    } catch (error: unknown) {
      await this.markWebhookFailed(input.tenantKey, reservation.id, error);
      throw error;
    }

    this.logger.info("connector.webhook.accepted", {
      slug: installation.slug,
      tenantKey: input.tenantKey,
      installationId: input.installationId,
      rawEventId: parsedEvent.rawEventId,
      eventType: parsedEvent.eventType,
      submissionId,
      status: parsedEvent.status ?? null,
    });

    return {
      accepted: true,
      duplicate: false,
      eventId: parsedEvent.rawEventId,
      eventType: parsedEvent.eventType,
      submissionId,
      status: parsedEvent.status ?? null,
    };
  }

  private async requireInstallation(tenantKey: string, installationId: string): Promise<ConnectorInstallationLookup> {
    const installation = await this.prisma.tenant(tenantKey).connectorInstallation.findFirst({
      where: { id: installationId },
      select: {
        id: true,
        tenantKey: true,
        connectorId: true,
      },
    });
    if (!installation) {
      throw new NotFoundException("Connector installation not found");
    }
    const connectorDefinition = await this.prisma.tenant(tenantKey).connectorDefinition.findUnique({
      where: { id: installation.connectorId },
      select: { slug: true },
    });
    if (!connectorDefinition) {
      throw new NotFoundException("Connector installation not found");
    }
    return {
      id: installation.id,
      tenantKey: installation.tenantKey,
      slug: connectorDefinition.slug,
    };
  }

  private async reserveWebhookEvent(
    tenantKey: string,
    installationId: string,
    parsedEvent: ParsedWebhookEvent,
    rawBody: Buffer,
  ): Promise<WebhookReservation> {
    const db = this.prisma.tenant(tenantKey);
    const eventId = randomUUID();
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + WEBHOOK_PROCESSING_LEASE_MS);
    const lockKey = `${tenantKey}:${installationId}:${parsedEvent.rawEventId}`;
    const payload = this.parsePayloadForStorage(rawBody);
    const rawBodySha256 = createHash("sha256").update(rawBody).digest("hex");

    return db.$transaction(async (tx) => {
      // pg_advisory_xact_lock() returns SQL void, which @prisma/client's $queryRaw
      // cannot deserialize ("Failed to deserialize column of type 'void'"). Use
      // $executeRaw, which discards the result set, to take the lock.
      await tx.$executeRaw(Prisma.sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0)::bigint)`);

      const existing = await tx.connectorWebhookEvent.findFirst({
        where: {
          tenantKey,
          installationId,
          externalEventId: parsedEvent.rawEventId,
        },
        select: {
          id: true,
          processedAt: true,
          processingStatus: true,
          processingLeaseUntil: true,
        },
      });

      if (existing?.processedAt || existing?.processingStatus === WEBHOOK_PROCESSING_STATUS_PROCESSED) {
        return { id: existing.id, duplicate: true, reason: "processed" };
      }

      if (
        existing?.processingStatus === WEBHOOK_PROCESSING_STATUS_PROCESSING &&
        existing.processingLeaseUntil &&
        existing.processingLeaseUntil.getTime() > now.getTime()
      ) {
        return { id: existing.id, duplicate: true, reason: "in_progress" };
      }

      if (existing) {
        await tx.connectorWebhookEvent.update({
          where: { id: existing.id },
          data: {
            eventType: parsedEvent.eventType,
            payload,
            rawBodySha256,
            processingStatus: WEBHOOK_PROCESSING_STATUS_PROCESSING,
            processingAttemptCount: { increment: 1 },
            processingLeaseUntil: leaseUntil,
            lastError: null,
          },
        });
        return { id: existing.id, duplicate: false };
      }

      const created = await tx.connectorWebhookEvent.create({
        data: {
          id: eventId,
          tenantKey,
          installationId,
          externalEventId: parsedEvent.rawEventId,
          eventType: parsedEvent.eventType,
          payload,
          rawBodySha256,
          processingStatus: WEBHOOK_PROCESSING_STATUS_PROCESSING,
          processingAttemptCount: 1,
          processingLeaseUntil: leaseUntil,
        },
        select: {
          id: true,
        },
      });
      return { id: created.id, duplicate: false };
    });
  }

  private async processReservedWebhookEvent(
    tenantKey: string,
    installationId: string,
    webhookId: string,
    parsedEvent: ParsedWebhookEvent,
  ): Promise<string | null> {
    return this.prisma.tenant(tenantKey).$transaction(async (tx) => {
      const submissionId = await this.resolveSubmissionFromWebhookTx(tx, tenantKey, installationId, parsedEvent);
      await tx.connectorWebhookEvent.updateMany({
        where: {
          id: webhookId,
          tenantKey,
          installationId,
          externalEventId: parsedEvent.rawEventId,
          processingStatus: WEBHOOK_PROCESSING_STATUS_PROCESSING,
        },
        data: {
          processedAt: new Date(),
          submissionId,
          processingStatus: WEBHOOK_PROCESSING_STATUS_PROCESSED,
          processingLeaseUntil: null,
          lastError: null,
        },
      });
      return submissionId;
    });
  }

  private async resolveSubmissionFromWebhookTx(
    tx: Prisma.TransactionClient,
    tenantKey: string,
    installationId: string,
    parsedEvent: ParsedWebhookEvent,
  ): Promise<string | null> {
    const submission = await this.findSubmissionTx(tx, tenantKey, installationId, parsedEvent);
    if (!submission || !parsedEvent.status) {
      return null;
    }

    const isTerminalStatus = ["SUCCESS", "REJECTED", "SUPPRESSED", "ERROR"].includes(parsedEvent.status);
    await tx.connectorSubmission.updateMany({
      where: { id: submission.id },
      data: {
        status: parsedEvent.status,
        channelErrors: this.normalizeIssues(parsedEvent.channelErrors) as Prisma.InputJsonValue,
        ...(isTerminalStatus ? { resolvedAt: new Date() } : {}),
      },
    });

    return submission.id;
  }

  private async findSubmissionTx(
    tx: Prisma.TransactionClient,
    tenantKey: string,
    installationId: string,
    parsedEvent: ParsedWebhookEvent,
  ): Promise<SubmissionLookup | null> {
    if (parsedEvent.externalRef) {
      const byExternalRef = await tx.connectorSubmission.findFirst({
        where: {
          tenantKey,
          installationId,
          externalRef: parsedEvent.externalRef,
        },
        orderBy: [{ submittedAt: "desc" }],
        select: { id: true },
      });
      if (byExternalRef) {
        return byExternalRef;
      }
    }

    if (!parsedEvent.productSku) {
      return null;
    }

    const rows = await tenantRaw<SubmissionLookup[]>(tx, `
      SELECT cs.id
      FROM connector_submissions cs
      JOIN "Product" p ON p.id = cs.product_id
      LEFT JOIN LATERAL (
        SELECT v."skuCode" AS sku
        FROM "Variant" v
        WHERE v."productId" = p.id
        ORDER BY v."updatedAt" DESC
        LIMIT 1
      ) latest_variant ON TRUE
      WHERE cs.tenant_key = $1
        AND cs.installation_id = $2
        AND cs.status = 'PENDING'
        AND COALESCE(NULLIF(latest_variant.sku, ''), NULLIF(p."attributes"->>'sku', ''), p.id) = $3
      ORDER BY cs.submitted_at DESC
      LIMIT 1
      `,
      [tenantKey, installationId, parsedEvent.productSku]);
    return rows[0] ?? null;
  }

  private async markWebhookFailed(tenantKey: string, webhookId: string, error: unknown): Promise<void> {
    const message = this.normalizeErrorMessage(error);
    await this.prisma.tenant(tenantKey).connectorWebhookEvent.updateMany({
      where: { id: webhookId },
      data: {
        processingStatus: WEBHOOK_PROCESSING_STATUS_FAILED,
        processingLeaseUntil: null,
        lastError: message,
      },
    });
  }

  /**
   * Re-drive a webhook event whose in-flight processing lease expired without a
   * redelivery (worker crashed mid-processing). Called by the lease sweeper, one
   * row at a time. Atomically re-acquires the expired lease (so a genuinely
   * in-flight event with a future lease, or one already reclaimed by a redelivery
   * or a peer sweeper, is never touched), then re-runs the same
   * processReservedWebhookEvent() step the live pipeline uses, using a
   * ParsedWebhookEvent reconstructed from the row's own persisted, previously
   * HMAC-verified state. On failure the attempt count advances and the lease is
   * released for the next sweep; once processingAttemptCount reaches maxAttempts
   * the row is parked in terminal 'failed' with last_error.
   */
  async redriveStrandedWebhookEvent(
    input: RedriveStrandedWebhookInput,
  ): Promise<{ id: string; outcome: RedriveStrandedWebhookOutcome }> {
    const db = this.prisma.tenant(input.tenantKey);
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + WEBHOOK_PROCESSING_LEASE_MS);

    const acquired = await db.connectorWebhookEvent.updateMany({
      where: {
        id: input.id,
        tenantKey: input.tenantKey,
        processingStatus: {
          in: [WEBHOOK_PROCESSING_STATUS_RECEIVED, WEBHOOK_PROCESSING_STATUS_PROCESSING],
        },
        processingLeaseUntil: { lt: now },
      },
      data: {
        processingStatus: WEBHOOK_PROCESSING_STATUS_PROCESSING,
        processingAttemptCount: { increment: 1 },
        processingLeaseUntil: leaseUntil,
      },
    });
    if (acquired.count === 0) {
      return { id: input.id, outcome: "skipped" };
    }

    const row = await db.connectorWebhookEvent.findFirst({
      where: { id: input.id, tenantKey: input.tenantKey },
      select: {
        id: true,
        installationId: true,
        externalEventId: true,
        eventType: true,
        payload: true,
        processingAttemptCount: true,
      },
    });
    if (!row) {
      return { id: input.id, outcome: "skipped" };
    }

    const capReached = row.processingAttemptCount >= input.maxAttempts;

    try {
      const installation = await this.requireInstallation(input.tenantKey, row.installationId);
      const connector = this.registry.getConnector(installation.slug);
      const parsedEvent = connector.parseStoredWebhookEvent
        ? connector.parseStoredWebhookEvent({
            payload: row.payload,
            eventType: row.eventType,
            rawEventId: row.externalEventId,
            installationId: row.installationId,
          })
        : null;

      if (!parsedEvent) {
        const reason = connector.parseStoredWebhookEvent
          ? "lease recovery: stored webhook payload could not be re-parsed"
          : `lease recovery: connector '${installation.slug}' does not support stored webhook replay`;
        return this.finishStrandedRedrive(input.tenantKey, row.id, capReached, reason);
      }

      const submissionId = await this.processReservedWebhookEvent(
        input.tenantKey,
        row.installationId,
        row.id,
        parsedEvent,
      );

      this.logger.info("connector.webhook.lease_recovered", {
        slug: installation.slug,
        tenantKey: input.tenantKey,
        installationId: row.installationId,
        rawEventId: row.externalEventId,
        eventType: parsedEvent.eventType,
        submissionId,
        attempt: row.processingAttemptCount,
      });
      return { id: row.id, outcome: "processed" };
    } catch (error: unknown) {
      return this.finishStrandedRedrive(
        input.tenantKey,
        row.id,
        capReached,
        `lease recovery: ${this.normalizeErrorMessage(error)}`,
      );
    }
  }

  private async finishStrandedRedrive(
    tenantKey: string,
    webhookId: string,
    capReached: boolean,
    reason: string,
  ): Promise<{ id: string; outcome: "failed" | "retry" }> {
    const db = this.prisma.tenant(tenantKey);
    const lastError = reason.slice(0, WEBHOOK_ERROR_MESSAGE_LIMIT);

    if (capReached) {
      await db.connectorWebhookEvent.updateMany({
        where: { id: webhookId, processingStatus: WEBHOOK_PROCESSING_STATUS_PROCESSING },
        data: {
          processingStatus: WEBHOOK_PROCESSING_STATUS_FAILED,
          processingLeaseUntil: null,
          lastError,
        },
      });
      this.logger.warn("connector.webhook.lease_recovery_exhausted", { webhookId, reason: lastError });
      return { id: webhookId, outcome: "failed" };
    }

    // Below the cap: release the lease immediately (already expired) so the next
    // sweep re-picks the row via idx_connector_webhooks_recovery.
    await db.connectorWebhookEvent.updateMany({
      where: { id: webhookId, processingStatus: WEBHOOK_PROCESSING_STATUS_PROCESSING },
      data: {
        processingStatus: WEBHOOK_PROCESSING_STATUS_RECEIVED,
        processingLeaseUntil: new Date(),
        lastError,
      },
    });
    return { id: webhookId, outcome: "retry" };
  }

  private parsePayloadForStorage(rawBody: Buffer): Prisma.InputJsonValue {
    try {
      return JSON.parse(rawBody.toString("utf8")) as Prisma.InputJsonValue;
    } catch {
      return {
        parseError: "invalid_json",
        rawBodySha256: createHash("sha256").update(rawBody).digest("hex"),
      };
    }
  }

  private normalizeErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error ?? "unknown");
    return message.slice(0, WEBHOOK_ERROR_MESSAGE_LIMIT);
  }

  private normalizeIssues(issues: ConnectorIssue[]): Array<Record<string, unknown>> {
    return (Array.isArray(issues) ? issues : []).map((issue) => ({
      code: issue.code,
      fieldPath: issue.fieldPath,
      severity: issue.severity,
      sellerMessage: issue.sellerMessage,
    }));
  }
}
