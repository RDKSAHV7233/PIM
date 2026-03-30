import { Injectable, NotFoundException } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { LoggerService } from "../common/logging/logger.service";
import { PrismaService } from "../prisma/prisma.service";
import { ConnectorRegistry } from "./connector.registry";
import { ConnectorIssue, ParsedWebhookEvent } from "./connector.interface";

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
    const rows = await this.prisma.tenant(tenantKey).$queryRawUnsafe<ConnectorInstallationLookup[]>(
      `
      SELECT
        ci.id,
        ci.tenant_key AS "tenantKey",
        cd.slug
      FROM connector_installations ci
      JOIN connector_definitions cd ON cd.id = ci.connector_id
      WHERE ci.tenant_key = $1
        AND ci.id = $2
      LIMIT 1
      `,
      tenantKey,
      installationId,
    );
    const installation = rows[0];
    if (!installation) {
      throw new NotFoundException("Connector installation not found");
    }
    return installation;
  }

  private async insertWebhookEvent(
    tenantKey: string,
    installationId: string,
    parsedEvent: ParsedWebhookEvent,
    rawBody: Buffer,
  ): Promise<string | null> {
    const rows = await this.prisma.tenant(tenantKey).$queryRawUnsafe<Array<{ id: string }>>(
      `
      INSERT INTO connector_webhook_events (
        id,
        tenant_key,
        installation_id,
        external_event_id,
        event_type,
        payload,
        received_at
      )
      VALUES (
        $6,
        $1,
        $2,
        $3,
        $4,
        $5::jsonb,
        NOW()
      )
      ON CONFLICT (installation_id, external_event_id) DO NOTHING
      RETURNING id
      `,
      tenantKey,
      installationId,
      parsedEvent.rawEventId,
      parsedEvent.eventType,
      rawBody.toString("utf8"),
      randomUUID(),
    );
    return rows[0]?.id ?? null;
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

    await this.prisma.tenant(tenantKey).$executeRawUnsafe(
      `
      UPDATE connector_submissions
      SET
        status = $3,
        channel_errors = $4::jsonb,
        resolved_at = CASE
          WHEN $3 IN ('SUCCESS', 'REJECTED', 'SUPPRESSED', 'ERROR') THEN NOW()
          ELSE resolved_at
        END
      WHERE tenant_key = $1
        AND id = $2
      `,
      tenantKey,
      submission.id,
      parsedEvent.status,
      JSON.stringify(this.normalizeIssues(parsedEvent.channelErrors)),
    );

    return submission.id;
  }

  private async findSubmission(
    tenantKey: string,
    installationId: string,
    parsedEvent: ParsedWebhookEvent,
  ): Promise<SubmissionLookup | null> {
    if (parsedEvent.externalRef) {
      const byExternalRef = await this.prisma.tenant(tenantKey).$queryRawUnsafe<SubmissionLookup[]>(
        `
        SELECT id
        FROM connector_submissions
        WHERE tenant_key = $1
          AND installation_id = $2
          AND external_ref = $3
        ORDER BY submitted_at DESC
        LIMIT 1
        `,
        tenantKey,
        installationId,
        parsedEvent.externalRef,
      );
      if (byExternalRef[0]) {
        return byExternalRef[0];
      }
    }

    if (!parsedEvent.productSku) {
      return null;
    }

    const rows = await this.prisma.tenant(tenantKey).$queryRawUnsafe<SubmissionLookup[]>(
      `
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
      tenantKey,
      installationId,
      parsedEvent.productSku,
    );
    return rows[0] ?? null;
  }

  private async markWebhookProcessed(tenantKey: string, webhookId: string, submissionId: string | null): Promise<void> {
    await this.prisma.tenant(tenantKey).$executeRawUnsafe(
      `
      UPDATE connector_webhook_events
      SET
        processed_at = NOW(),
        submission_id = $3
      WHERE tenant_key = $1
        AND id = $2
      `,
      tenantKey,
      webhookId,
      submissionId,
    );
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
