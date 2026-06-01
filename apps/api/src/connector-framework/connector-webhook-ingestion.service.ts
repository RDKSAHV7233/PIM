import { Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
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

    const parsedEvent = await connector.parseWebhookEvent(input.rawBody, input.headers);
    if (!parsedEvent) {
      return {
        accepted: false,
        duplicate: false,
        reason: "invalid_signature_or_payload",
      };
    }

    const insertedWebhookId = await this.insertWebhookEvent(input.tenantKey, input.installationId, parsedEvent, input.rawBody);
    if (!insertedWebhookId) {
      return {
        accepted: true,
        duplicate: true,
        eventId: parsedEvent.rawEventId,
        eventType: parsedEvent.eventType,
        submissionId: null,
        status: parsedEvent.status ?? null,
      };
    }

    const submissionId = await this.resolveSubmissionFromWebhook(input.tenantKey, input.installationId, parsedEvent);
    await this.markWebhookProcessed(input.tenantKey, insertedWebhookId, submissionId);

    this.logger.info("Connector webhook ingested", {
      tenantKey: input.tenantKey,
      installationId: input.installationId,
      connectorSlug: installation.slug,
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

  private async insertWebhookEvent(
    tenantKey: string,
    installationId: string,
    parsedEvent: ParsedWebhookEvent,
    rawBody: Buffer,
  ): Promise<string | null> {
    const eventId = randomUUID();
    try {
      const created = await this.prisma.tenant(tenantKey).connectorWebhookEvent.create({
        data: {
          id: eventId,
          installationId,
          externalEventId: parsedEvent.rawEventId,
          eventType: parsedEvent.eventType,
          payload: JSON.parse(rawBody.toString("utf8")),
        },
        select: {
          id: true,
        },
      });
      return created.id;
    } catch (error: unknown) {
      if (error instanceof Error && "code" in error && (error as { code?: string }).code === "P2002") {
        return null;
      }
      throw error;
    }
  }

  private async resolveSubmissionFromWebhook(
    tenantKey: string,
    installationId: string,
    parsedEvent: ParsedWebhookEvent,
  ): Promise<string | null> {
    const submission = await this.findSubmission(tenantKey, installationId, parsedEvent);
    if (!submission || !parsedEvent.status) {
      return null;
    }

    const isTerminalStatus = ["SUCCESS", "REJECTED", "SUPPRESSED", "ERROR"].includes(parsedEvent.status);
    await this.prisma.tenant(tenantKey).connectorSubmission.updateMany({
      where: { id: submission.id },
      data: {
        status: parsedEvent.status,
        channelErrors: this.normalizeIssues(parsedEvent.channelErrors) as Prisma.InputJsonValue,
        ...(isTerminalStatus ? { resolvedAt: new Date() } : {}),
      },
    });

    return submission.id;
  }

  private async findSubmission(
    tenantKey: string,
    installationId: string,
    parsedEvent: ParsedWebhookEvent,
  ): Promise<SubmissionLookup | null> {
    if (parsedEvent.externalRef) {
      const byExternalRef = await this.prisma.tenant(tenantKey).connectorSubmission.findFirst({
        where: {
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

    const rows = await tenantRaw<SubmissionLookup[]>(this.prisma.tenant(tenantKey), `
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

  private async markWebhookProcessed(tenantKey: string, webhookId: string, submissionId: string | null): Promise<void> {
    await this.prisma.tenant(tenantKey).connectorWebhookEvent.updateMany({
      where: { id: webhookId },
      data: {
        processedAt: new Date(),
        submissionId,
      },
    });
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
