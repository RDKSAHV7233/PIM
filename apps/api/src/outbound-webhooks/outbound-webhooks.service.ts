import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHmac } from "node:crypto";
import { randomUUID } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { PlanUsageService } from "../billing/plan-usage.service";
import type { AppRole } from "../common/rbac/roles";
import { normalizeTenantKey } from "../common/tenant/tenant.constants";
import {
  buildEncryptedCredential,
  decryptCredentialValue,
  loadCredentialEncryptionKeys,
  parseCredentialKeyVersion,
  resolveCurrentCredentialKeyVersion,
} from "../connector-installer/credential-encryption.util";
import type { NotificationEventType } from "../notifications/notification-event.types";
import { PrismaService } from "../prisma/prisma.service";
import { QUEUE_NAMES } from "../queue/queue.constants";
import { QueueService } from "../queue/queue.service";
import { CreateOutboundWebhookDto } from "./dto/create-outbound-webhook.dto";
import { ListOutboundWebhookDeliveriesDto } from "./dto/list-outbound-webhook-deliveries.dto";
import { UpdateOutboundWebhookDto } from "./dto/update-outbound-webhook.dto";

const OUTBOUND_WEBHOOK_TIMEOUT_MS = 10_000;
const OUTBOUND_WEBHOOK_MAX_RESPONSE_CHARS = 2_000;
const OUTBOUND_WEBHOOK_STUCK_QUEUED_MS = 60_000;
const OUTBOUND_WEBHOOK_RECOVERY_INTERVAL_MS = 60_000;
const OUTBOUND_WEBHOOK_ENQUEUE_ERROR_LIMIT = 1_000;

export type OutboundWebhookDeliveryStatus = "queued" | "delivered" | "failed" | "skipped";

export interface OutboundWebhookEndpointRecord {
  id: string;
  name: string;
  eventType: NotificationEventType;
  targetUrl: string;
  isActive: boolean;
  createdBy: string | null;
  lastTriggeredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OutboundWebhookDeliveryRecord {
  id: string;
  endpointId: string;
  endpointName: string | null;
  eventType: NotificationEventType;
  eventId: string;
  status: OutboundWebhookDeliveryStatus;
  attemptCount: number;
  responseStatus: number | null;
  errorMessage: string | null;
  queueJobId: string | null;
  enqueueError: string | null;
  attemptedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationWebhookEventInput {
  tenantKey: string;
  notificationId: string;
  eventType: NotificationEventType;
  userId: string;
  title: string;
  message: string;
  actionUrl?: string | null;
  actionLabel?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: string;
}

type DeliveryQueuePayload = {
  tenantKey: string;
  endpointId: string;
  deliveryId: string;
  forceDelivery?: boolean;
};

type WebhookPayload = {
  id: string;
  type: NotificationEventType;
  source: "notification" | "test";
  occurredAt: string;
  tenantKey: string;
  userId: string;
  title: string;
  message: string;
  actionUrl: string | null;
  actionLabel: string | null;
  metadata: Record<string, unknown>;
};

@Injectable()
export class OutboundWebhooksService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly encryptionKeys = loadCredentialEncryptionKeys(process.env);
  private readonly currentKeyVersion = resolveCurrentCredentialKeyVersion(process.env);
  private recoveryTimer: ReturnType<typeof setInterval> | null = null;
  private recoveringQueuedDeliveries = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly queueService: QueueService,
    private readonly planUsageService: PlanUsageService,
  ) {
    this.registerWorker();
  }

  onApplicationBootstrap(): void {
    if (String(process.env.OUTBOUND_WEBHOOK_RECOVERY_DISABLED ?? "").trim().toLowerCase() === "true") {
      return;
    }
    this.recoveryTimer = setInterval(() => {
      void this.recoverStuckQueuedDeliveries();
    }, OUTBOUND_WEBHOOK_RECOVERY_INTERVAL_MS);
  }

  onApplicationShutdown(): void {
    if (this.recoveryTimer) {
      clearInterval(this.recoveryTimer);
      this.recoveryTimer = null;
    }
  }

  async listEndpoints(tenantKeyInput: string): Promise<OutboundWebhookEndpointRecord[]> {
    const tenantKey = normalizeTenantKey(tenantKeyInput);
    const rows = await this.prisma.tenant(tenantKey).outboundWebhookEndpoint.findMany({
      where: {
        tenantKey,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 200,
      select: {
        id: true,
        name: true,
        eventType: true,
        targetUrl: true,
        isActive: true,
        createdBy: true,
        lastTriggeredAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return rows.map((row) => this.mapEndpoint(row));
  }

  async createEndpoint(
    tenantKeyInput: string,
    actorId: string,
    actorRole: AppRole,
    dto: CreateOutboundWebhookDto,
  ): Promise<OutboundWebhookEndpointRecord> {
    const tenantKey = normalizeTenantKey(tenantKeyInput);
    const name = String(dto.name ?? "").trim();
    // Registration soft-allows a target that currently returns no DNS records
    // (transient resolver failure / offline box). Private/loopback/metadata IPs
    // and blocked hosts are still rejected here; dispatch re-validates strictly.
    const targetUrl = await this.normalizeTargetUrl(dto.targetUrl, { requireResolvable: false });
    const signingSecret = String(dto.signingSecret ?? "").trim();
    if (!name) {
      throw new BadRequestException("Webhook name is required.");
    }
    if (!signingSecret) {
      throw new BadRequestException("Webhook signing secret is required.");
    }

    const encrypted = this.encryptSecret(signingSecret);
    const created = await this.prisma.tenant(tenantKey).outboundWebhookEndpoint.create({
      data: {
        tenantKey,
        name,
        eventType: dto.eventType,
        targetUrl,
        signingSecretEncrypted: encrypted.cipher,
        signingSecretKeyVersion: encrypted.keyVersion,
        isActive: dto.isActive ?? true,
        createdBy: actorId,
      },
      select: {
        id: true,
        name: true,
        eventType: true,
        targetUrl: true,
        isActive: true,
        createdBy: true,
        lastTriggeredAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await this.auditService.record({
      actorId,
      actorRole,
      action: "outbound_webhook.created",
      resource: "OutboundWebhookEndpoint",
      resourceId: created.id,
      metadata: {
        eventType: created.eventType,
        name: created.name,
        targetUrl: created.targetUrl,
        isActive: created.isActive,
      },
    });

    return this.mapEndpoint(created);
  }

  async updateEndpoint(
    tenantKeyInput: string,
    actorId: string,
    actorRole: AppRole,
    endpointId: string,
    dto: UpdateOutboundWebhookDto,
  ): Promise<OutboundWebhookEndpointRecord> {
    const tenantKey = normalizeTenantKey(tenantKeyInput);
    const existing = await this.requireEndpoint(tenantKey, endpointId);
    const data: Record<string, unknown> = {};
    const metadata: Record<string, unknown> = {};

    if (dto.name !== undefined) {
      const name = String(dto.name ?? "").trim();
      if (!name) {
        throw new BadRequestException("Webhook name is required.");
      }
      data.name = name;
      metadata.name = data.name;
    }
    if (dto.targetUrl !== undefined) {
      // Same soft-allow as create(): a transient DNS miss must not block an edit.
      data.targetUrl = await this.normalizeTargetUrl(dto.targetUrl, { requireResolvable: false });
      metadata.targetUrl = data.targetUrl;
    }
    if (dto.isActive !== undefined) {
      data.isActive = dto.isActive;
      metadata.isActive = dto.isActive;
    }
    if (dto.signingSecret !== undefined) {
      const signingSecret = String(dto.signingSecret ?? "").trim();
      if (!signingSecret) {
        throw new BadRequestException("Webhook signing secret is required.");
      }
      const encrypted = this.encryptSecret(signingSecret);
      data.signingSecretEncrypted = encrypted.cipher;
      data.signingSecretKeyVersion = encrypted.keyVersion;
      metadata.signingSecretRotated = true;
    }

    if (Object.keys(data).length === 0) {
      return this.mapEndpoint(existing);
    }

    const updated = await this.prisma.tenant(tenantKey).outboundWebhookEndpoint.update({
      where: { id: existing.id },
      data,
      select: {
        id: true,
        name: true,
        eventType: true,
        targetUrl: true,
        isActive: true,
        createdBy: true,
        lastTriggeredAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await this.auditService.record({
      actorId,
      actorRole,
      action: "outbound_webhook.updated",
      resource: "OutboundWebhookEndpoint",
      resourceId: updated.id,
      metadata,
    });

    return this.mapEndpoint(updated);
  }

  async deleteEndpoint(
    tenantKeyInput: string,
    actorId: string,
    actorRole: AppRole,
    endpointId: string,
  ): Promise<{ id: string; deleted: true }> {
    const tenantKey = normalizeTenantKey(tenantKeyInput);
    const existing = await this.requireEndpoint(tenantKey, endpointId);

    await this.prisma.tenant(tenantKey).outboundWebhookEndpoint.delete({
      where: { id: existing.id },
    });

    await this.auditService.record({
      actorId,
      actorRole,
      action: "outbound_webhook.deleted",
      resource: "OutboundWebhookEndpoint",
      resourceId: existing.id,
      metadata: {
        eventType: existing.eventType,
        name: existing.name,
        targetUrl: existing.targetUrl,
      },
    });

    return { id: existing.id, deleted: true as const };
  }

  async listDeliveries(
    tenantKeyInput: string,
    query: ListOutboundWebhookDeliveriesDto,
  ): Promise<OutboundWebhookDeliveryRecord[]> {
    const tenantKey = normalizeTenantKey(tenantKeyInput);
    const limit = Math.max(1, Math.min(200, Number(query.limit ?? 50) || 50));
    const rows = await this.prisma.tenant(tenantKey).outboundWebhookDelivery.findMany({
      where: {
        tenantKey,
        endpointId: query.endpointId ? String(query.endpointId).trim() : undefined,
        status: query.status,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: limit,
      select: {
        id: true,
        endpointId: true,
        eventType: true,
        eventId: true,
        status: true,
        attemptCount: true,
        responseStatus: true,
        errorMessage: true,
        queueJobId: true,
        enqueueError: true,
        attemptedAt: true,
        deliveredAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const endpointIds = Array.from(new Set(rows.map((row) => row.endpointId)));
    const endpoints = endpointIds.length > 0
      ? await this.prisma.tenant(tenantKey).outboundWebhookEndpoint.findMany({
          where: {
            tenantKey,
            id: { in: endpointIds },
          },
          select: {
            id: true,
            name: true,
          },
        })
      : [];
    const endpointNames = new Map(endpoints.map((row) => [row.id, row.name]));

    return rows.map((row) => this.mapDelivery(row, endpointNames.get(row.endpointId) ?? null));
  }

  async sendTestDelivery(
    tenantKeyInput: string,
    actorId: string,
    actorRole: AppRole,
    endpointId: string,
  ): Promise<OutboundWebhookDeliveryRecord> {
    const tenantKey = normalizeTenantKey(tenantKeyInput);
    const endpoint = await this.requireEndpoint(tenantKey, endpointId);
    const occurredAt = new Date().toISOString();
    const eventId = randomUUID();
    const payload = this.buildTestPayload({
      eventId,
      endpointId: endpoint.id,
      endpointName: endpoint.name,
      eventType: endpoint.eventType as NotificationEventType,
      tenantKey,
      actorId,
      occurredAt,
    });
    const delivery = await this.createQueuedDelivery(
      tenantKey,
      endpoint.id,
      endpoint.eventType as NotificationEventType,
      eventId,
      payload,
      { forceDelivery: true },
    );

    await this.auditService.record({
      actorId,
      actorRole,
      action: "outbound_webhook.test_requested",
      resource: "OutboundWebhookEndpoint",
      resourceId: endpoint.id,
      metadata: {
        eventId,
        eventType: endpoint.eventType,
        endpointName: endpoint.name,
        targetUrl: endpoint.targetUrl,
      },
    });

    return this.mapDelivery(delivery, endpoint.name);
  }

  async retryFailedDelivery(
    tenantKeyInput: string,
    actorId: string,
    actorRole: AppRole,
    deliveryId: string,
  ): Promise<OutboundWebhookDeliveryRecord> {
    const tenantKey = normalizeTenantKey(tenantKeyInput);
    const existing = await this.prisma.tenant(tenantKey).outboundWebhookDelivery.findUnique({
      where: { id: deliveryId },
      select: {
        id: true,
        tenantKey: true,
        endpointId: true,
        eventType: true,
        eventId: true,
        status: true,
        requestBody: true,
      },
    });
    if (!existing || existing.tenantKey !== tenantKey) {
      throw new NotFoundException("Outbound webhook delivery not found.");
    }
    if (existing.status !== "failed") {
      throw new BadRequestException("Only failed webhook deliveries can be retried.");
    }

    const endpoint = await this.prisma.tenant(tenantKey).outboundWebhookEndpoint.findUnique({
      where: { id: existing.endpointId },
      select: {
        id: true,
        name: true,
        isActive: true,
      },
    });
    if (!endpoint) {
      throw new NotFoundException("Outbound webhook endpoint not found.");
    }
    if (!endpoint.isActive) {
      throw new BadRequestException("Resume the webhook endpoint before retrying this delivery.");
    }

    const requestBody = existing.requestBody && typeof existing.requestBody === "object"
      ? existing.requestBody
      : {};
    const retry = await this.createQueuedDelivery(
      tenantKey,
      endpoint.id,
      existing.eventType as NotificationEventType,
      existing.eventId,
      requestBody as Prisma.InputJsonValue,
    );

    await this.auditService.record({
      actorId,
      actorRole,
      action: "outbound_webhook.delivery_retry_queued",
      resource: "OutboundWebhookDelivery",
      resourceId: retry.id,
      metadata: {
        originalDeliveryId: existing.id,
        endpointId: endpoint.id,
        endpointName: endpoint.name,
        eventId: existing.eventId,
        eventType: existing.eventType,
      },
    });

    return this.mapDelivery(retry, endpoint.name);
  }

  async enqueueNotificationEvent(input: NotificationWebhookEventInput): Promise<void> {
    const tenantKey = normalizeTenantKey(input.tenantKey);
    const endpoints = await this.prisma.tenant(tenantKey).outboundWebhookEndpoint.findMany({
      where: {
        tenantKey,
        eventType: input.eventType,
        isActive: true,
      },
      take: 50, // defensive cap — tenants configure few webhook endpoints per event type
      select: {
        id: true,
      },
    });

    if (endpoints.length === 0) {
      return;
    }

    const payload = this.buildPayload(input);
    // Each endpoint delivery is independent (separate DB row + separate queue entry) —
    // run them in parallel. allSettled: a single endpoint failure must not suppress others.
    await Promise.allSettled(
      endpoints.map((endpoint) =>
        this.createQueuedDelivery(tenantKey, endpoint.id, input.eventType, input.notificationId, payload),
      ),
    );
  }

  async recoverStuckQueuedDeliveries(limit = 100): Promise<{ recovered: number; failed: number }> {
    if (this.recoveringQueuedDeliveries) {
      return { recovered: 0, failed: 0 };
    }
    this.recoveringQueuedDeliveries = true;
    const cutoff = new Date(Date.now() - OUTBOUND_WEBHOOK_STUCK_QUEUED_MS);
    let recovered = 0;
    let failed = 0;
    try {
      // RLS-BYPASS: intentional cross-tenant scan — scheduled recovery job, must find
      // every tenant's stuck queued deliveries, not just one; each row carries its own
      // tenantKey for correctly-scoped per-row recovery below.
      const rows = await this.prisma.tenant().$queryRaw<
        Array<{ id: string; tenantKey: string; endpointId: string }>
      >(Prisma.sql`
        SELECT id, tenant_key AS "tenantKey", endpoint_id AS "endpointId"
        FROM outbound_webhook_deliveries
        WHERE status = 'queued'
          AND attempted_at IS NULL
          AND created_at < ${cutoff}
          AND (last_enqueue_attempt_at IS NULL OR last_enqueue_attempt_at < ${cutoff})
        ORDER BY created_at ASC
        LIMIT ${Math.max(1, Math.min(500, Math.floor(limit)))}
      `);

      for (const row of rows) {
        const delivery = await this.enqueueDelivery(row.tenantKey, row.id, row.endpointId);
        if (delivery.status === "failed") {
          failed++;
        } else {
          recovered++;
        }
      }
      if (recovered > 0 || failed > 0) {
        await this.auditService.record({
          actorId: "system",
          actorRole: "system",
          action: "outbound_webhook.queued_recovery",
          resource: "OutboundWebhookDelivery",
          resourceId: "stuck-queued",
          metadata: { recovered, failed },
        });
      }
      return { recovered, failed };
    } finally {
      this.recoveringQueuedDeliveries = false;
    }
  }

  private registerWorker() {
    this.queueService.processWithBackpressure<DeliveryQueuePayload>(
      QUEUE_NAMES.WEBHOOK_EVENT,
      {
        laneResolver: (payload) => String(payload.endpointId ?? "default"),
        defaultLanePolicy: {
          concurrency: 2,
          minIntervalMs: 100,
          rateLimitFailureThreshold: 3,
          pauseDurationMs: 30_000,
        },
      },
      async (payload) => {
        await this.processDelivery(payload);
      },
    );
  }

  private async processDelivery(payload: DeliveryQueuePayload): Promise<void> {
    const tenantKey = normalizeTenantKey(payload.tenantKey);

    // All three reads are independent (tenantKey, deliveryId, and endpointId are all
    // known from the payload at this point).  Run them in parallel to save 2 round-trips.
    const [delivery, commercialProfile, endpoint] = await Promise.all([
      this.prisma.tenant(tenantKey).outboundWebhookDelivery.findUnique({
        where: { id: payload.deliveryId },
        select: {
          id: true,
          endpointId: true,
          eventType: true,
          eventId: true,
          status: true,
          requestBody: true,
        },
      }),
      this.planUsageService.getTenantPlanProfile(tenantKey),
      this.prisma.tenant(tenantKey).outboundWebhookEndpoint.findUnique({
        where: { id: payload.endpointId },
        select: {
          id: true,
          tenantKey: true,
          targetUrl: true,
          signingSecretEncrypted: true,
          signingSecretKeyVersion: true,
          isActive: true,
        },
      }),
    ]);

    if (!delivery || delivery.status !== "queued") {
      return;
    }

    if (commercialProfile.accessStatus === "suspended") {
      const attemptedAt = new Date();
      await this.prisma.tenant(tenantKey).outboundWebhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "skipped",
          responseStatus: null,
          responseBody: null,
          deliveredAt: null,
          errorMessage: "tenant_suspended",
          attemptedAt,
          attemptCount: { increment: 1 },
        },
      });
      await this.auditService.record({
        actorId: "system",
        actorRole: "public",
        action: "outbound_webhook.delivery_skipped",
        resource: "OutboundWebhookDelivery",
        resourceId: delivery.id,
        metadata: {
          tenantKey,
          endpointId: delivery.endpointId,
          eventId: delivery.eventId,
          eventType: delivery.eventType,
          reason: "tenant_suspended",
        },
      });
      return;
    }

    if (!endpoint || (!endpoint.isActive && !payload.forceDelivery)) {
      await this.prisma.tenant(tenantKey).outboundWebhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "skipped",
          errorMessage: endpoint ? "endpoint_inactive" : "endpoint_not_found",
          attemptedAt: new Date(),
          attemptCount: { increment: 1 },
        },
      });
      return;
    }

    const requestBody = JSON.stringify(delivery.requestBody ?? {});
    const timestamp = new Date().toISOString();
    const signature = this.signPayload(requestBody, timestamp, endpoint.signingSecretEncrypted, endpoint.signingSecretKeyVersion);

    try {
      // Dispatch-time re-validation is strict (requireResolvable defaults to
      // true): a target that no longer resolves must not be contacted.
      const targetUrl = await this.normalizeTargetUrl(endpoint.targetUrl);
      const response = await fetch(targetUrl, {
        method: "POST",
        redirect: "manual",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "PIM1-OutboundWebhook/1.0",
          "X-PIM1-Webhook-Event": delivery.eventType,
          "X-PIM1-Webhook-Delivery-Id": delivery.id,
          "X-PIM1-Webhook-Event-Id": delivery.eventId,
          "X-PIM1-Webhook-Timestamp": timestamp,
          "X-PIM1-Webhook-Signature": `sha256=${signature}`,
        },
        body: requestBody,
        signal: AbortSignal.timeout(OUTBOUND_WEBHOOK_TIMEOUT_MS),
      });

      const responseBody = this.truncateResponse(await response.text());
      if (!response.ok) {
        const error = new Error(`Outbound webhook endpoint returned ${response.status}`);
        (error as Error & { responseStatus?: number; responseBody?: string | null }).responseStatus = response.status;
        (error as Error & { responseStatus?: number; responseBody?: string | null }).responseBody = responseBody;
        throw error;
      }

      const now = new Date();
      await this.prisma.tenant(tenantKey).outboundWebhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "delivered",
          responseStatus: response.status,
          responseBody,
          errorMessage: null,
          attemptedAt: now,
          deliveredAt: now,
          attemptCount: { increment: 1 },
        },
      });
      await this.prisma.tenant(tenantKey).outboundWebhookEndpoint.update({
        where: { id: endpoint.id },
        data: {
          lastTriggeredAt: now,
        },
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error ?? "delivery_failed");
      const responseStatus =
        error instanceof Error && "responseStatus" in error && typeof error.responseStatus === "number"
          ? error.responseStatus
          : null;
      const responseBody =
        error instanceof Error && "responseBody" in error && typeof error.responseBody === "string"
          ? error.responseBody
          : null;
      await this.prisma.tenant(tenantKey).outboundWebhookDelivery.update({
        where: { id: delivery.id },
        data: {
          status: "failed",
          responseStatus,
          responseBody,
          errorMessage: message,
          attemptedAt: new Date(),
          attemptCount: { increment: 1 },
        },
      });
      throw error;
    }
  }

  private buildPayload(input: NotificationWebhookEventInput): WebhookPayload {
    return {
      id: input.notificationId,
      type: input.eventType,
      source: "notification",
      occurredAt: input.createdAt,
      tenantKey: normalizeTenantKey(input.tenantKey),
      userId: String(input.userId ?? "").trim(),
      title: String(input.title ?? "").trim(),
      message: String(input.message ?? "").trim(),
      actionUrl: input.actionUrl ? String(input.actionUrl).trim() : null,
      actionLabel: input.actionLabel ? String(input.actionLabel).trim() : null,
      metadata: input.metadata && typeof input.metadata === "object" ? input.metadata : {},
    };
  }

  private buildTestPayload(input: {
    eventId: string;
    endpointId: string;
    endpointName: string;
    eventType: NotificationEventType;
    tenantKey: string;
    actorId: string;
    occurredAt: string;
  }): WebhookPayload {
    return {
      id: input.eventId,
      type: input.eventType,
      source: "test",
      occurredAt: input.occurredAt,
      tenantKey: input.tenantKey,
      userId: input.actorId,
      title: `Vexa PIM test delivery: ${input.endpointName}`,
      message: `This is a test webhook delivery for ${input.eventType}.`,
      actionUrl: null,
      actionLabel: null,
      metadata: {
        test: true,
        endpointId: input.endpointId,
        endpointName: input.endpointName,
        triggeredBy: input.actorId,
      },
    };
  }

  private async createQueuedDelivery(
    tenantKey: string,
    endpointId: string,
    eventType: NotificationEventType,
    eventId: string,
    payload: WebhookPayload | Prisma.InputJsonValue,
    options?: { forceDelivery?: boolean },
  ) {
    const delivery = await this.prisma.tenant(tenantKey).outboundWebhookDelivery.create({
      data: {
        tenantKey,
        endpointId,
        eventType,
        eventId,
        status: "queued",
        requestBody: payload as Prisma.InputJsonValue,
      },
      select: {
        id: true,
        endpointId: true,
        eventType: true,
        eventId: true,
        status: true,
        attemptCount: true,
        responseStatus: true,
        errorMessage: true,
        queueJobId: true,
        enqueueError: true,
        attemptedAt: true,
        deliveredAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return this.enqueueDelivery(tenantKey, delivery.id, endpointId, options);
  }

  private async enqueueDelivery(
    tenantKey: string,
    deliveryId: string,
    endpointId: string,
    options?: { forceDelivery?: boolean },
  ) {
    const queueJobId = `outbound-webhook:${tenantKey}:${deliveryId}`;
    const now = new Date();
    try {
      await this.queueService.enqueue(
        QUEUE_NAMES.WEBHOOK_EVENT,
        {
          tenantKey,
          endpointId,
          deliveryId,
          forceDelivery: options?.forceDelivery === true,
        } satisfies DeliveryQueuePayload,
        { jobId: queueJobId },
      );
      return this.prisma.tenant(tenantKey).outboundWebhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: "queued",
          queueJobId,
          lastEnqueueAttemptAt: now,
          enqueueError: null,
          errorMessage: null,
        },
        select: this.deliverySelect(),
      });
    } catch (error: unknown) {
      const message = this.normalizeEnqueueError(error);
      return this.prisma.tenant(tenantKey).outboundWebhookDelivery.update({
        where: { id: deliveryId },
        data: {
          status: "failed",
          queueJobId,
          lastEnqueueAttemptAt: now,
          enqueueError: message,
          errorMessage: `enqueue_failed: ${message}`,
        },
        select: this.deliverySelect(),
      });
    }
  }

  private async normalizeTargetUrl(
    value: string,
    options?: { requireResolvable?: boolean },
  ): Promise<string> {
    const { validateWebhookTargetUrl } = await import("../common/security/url-safety");
    return validateWebhookTargetUrl(value, options ?? {});
  }

  private deliverySelect() {
    return {
      id: true,
      endpointId: true,
      eventType: true,
      eventId: true,
      status: true,
      attemptCount: true,
      responseStatus: true,
      errorMessage: true,
      queueJobId: true,
      enqueueError: true,
      attemptedAt: true,
      deliveredAt: true,
      createdAt: true,
      updatedAt: true,
    } as const;
  }

  private normalizeEnqueueError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error ?? "unknown");
    return message.slice(0, OUTBOUND_WEBHOOK_ENQUEUE_ERROR_LIMIT);
  }

  private encryptSecret(secret: string): { cipher: string; keyVersion: string } {
    const encrypted = buildEncryptedCredential(secret, this.currentKeyVersion, this.encryptionKeys);
    return {
      cipher: encrypted.cipher,
      keyVersion: `v${encrypted.keyVersion}`,
    };
  }

  private decryptSecret(cipher: string, keyVersion: string): string {
    const version = parseCredentialKeyVersion(keyVersion);
    const key = this.encryptionKeys.get(version);
    if (!key) {
      throw new Error(`Missing credential encryption key for version ${version}.`);
    }
    return decryptCredentialValue(cipher, key);
  }

  private signPayload(body: string, timestamp: string, cipher: string, keyVersion: string): string {
    const secret = this.decryptSecret(cipher, keyVersion);
    return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  }

  private truncateResponse(value: string): string | null {
    const normalized = String(value ?? "");
    if (!normalized) {
      return null;
    }
    return normalized.slice(0, OUTBOUND_WEBHOOK_MAX_RESPONSE_CHARS);
  }

  private async requireEndpoint(tenantKey: string, endpointId: string) {
    const endpoint = await this.prisma.tenant(tenantKey).outboundWebhookEndpoint.findUnique({
      where: { id: endpointId },
      select: {
        id: true,
        name: true,
        eventType: true,
        targetUrl: true,
        isActive: true,
        createdBy: true,
        lastTriggeredAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!endpoint || endpoint.id.trim().length === 0) {
      throw new NotFoundException("Outbound webhook endpoint not found.");
    }
    return endpoint;
  }

  private mapEndpoint(row: {
    id: string;
    name: string;
    eventType: string;
    targetUrl: string;
    isActive: boolean;
    createdBy: string | null;
    lastTriggeredAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
  }): OutboundWebhookEndpointRecord {
    return {
      id: row.id,
      name: row.name,
      eventType: row.eventType as NotificationEventType,
      targetUrl: row.targetUrl,
      isActive: row.isActive,
      createdBy: row.createdBy,
      lastTriggeredAt: row.lastTriggeredAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private mapDelivery(
    row: {
      id: string;
      endpointId: string;
      eventType: string;
      eventId: string;
      status: string;
      attemptCount: number;
      responseStatus: number | null;
      errorMessage: string | null;
      queueJobId?: string | null;
      enqueueError?: string | null;
      attemptedAt: Date | null;
      deliveredAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
    },
    endpointName: string | null,
  ): OutboundWebhookDeliveryRecord {
    return {
      id: row.id,
      endpointId: row.endpointId,
      endpointName,
      eventType: row.eventType as NotificationEventType,
      eventId: row.eventId,
      status: row.status as OutboundWebhookDeliveryStatus,
      attemptCount: row.attemptCount,
      responseStatus: row.responseStatus,
      errorMessage: row.errorMessage,
      queueJobId: row.queueJobId ?? null,
      enqueueError: row.enqueueError ?? null,
      attemptedAt: row.attemptedAt?.toISOString() ?? null,
      deliveredAt: row.deliveredAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
