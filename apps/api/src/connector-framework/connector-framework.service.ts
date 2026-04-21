import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getTenantKeyFromContext } from "../common/tenant/tenant-context";
import { PrismaService } from "../prisma/prisma.service";
import {
  CapabilityNotSupportedError,
  CredentialExpiredError,
  InstallationNotFoundError,
} from "./connector.errors";
import {
  ConnectorCap,
  ConnectorContext,
  ConnectorImplementationStatus,
  ProductPayload,
  SubmissionRef,
  SubmissionStatusUpdate,
  ValidationResult,
} from "./connector.interface";
import { resolveConnectorLaunchPolicy } from "./connector-launch-policy";
import { ConnectorRegistry } from "./connector.registry";
import { ConnectorInstallationRecord } from "./connector.types";

function parseCapabilities(raw: unknown): ConnectorCap[] {
  if (Array.isArray(raw)) {
    return raw.filter((value): value is ConnectorCap => typeof value === "string") as ConnectorCap[];
  }
  if (typeof raw === "string") {
    const value = raw.trim();
    if (value.startsWith("{") && value.endsWith("}")) {
      return value
        .slice(1, -1)
        .split(",")
        .map((item) => item.replace(/^"|"$/g, "").trim())
        .filter((item) => item.length > 0) as ConnectorCap[];
    }
  }
  return [];
}

function parseMetadata(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return {};
    }
  }
  return {};
}

const PAYLOAD_SNAPSHOT_CAP_BYTES = 64 * 1024;

@Injectable()
export class ConnectorFrameworkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: ConnectorRegistry,
  ) {}

  private resolveImplementationStatus(slug: string): ConnectorImplementationStatus {
    try {
      return this.registry.getConnector(slug).implementationStatus ?? "stub";
    } catch {
      return "stub";
    }
  }

  async getInstallation(tenantKey: string, slug: string): Promise<ConnectorInstallationRecord | null> {
    // RLS-BYPASS: manual tenant filter
    const rows = await this.prisma.tenant(tenantKey).$queryRawUnsafe<Array<Record<string, unknown>>>(
      `
      SELECT
        ci.id,
        ci.tenant_key AS "tenantKey",
        ci.connector_id AS "connectorId",
        cd.slug,
        cd.display_name AS "displayName",
        ci.account_alias AS "accountAlias",
        ci.external_account_ref AS "externalAccountRef",
        ci.status,
        cd.capabilities,
        ci.metadata,
        ci.installed_at AS "installedAt",
        ci.installed_by AS "installedBy",
        ci.last_sync_at AS "lastSyncAt",
        ci.created_at AS "createdAt",
        ci.updated_at AS "updatedAt"
      FROM connector_installations ci
      JOIN connector_definitions cd ON cd.id = ci.connector_id
      WHERE ci.tenant_key = $1 AND cd.slug = $2
      ORDER BY ci.installed_at DESC
      LIMIT 1
      `,
      tenantKey,
      slug,
    );

    const row = rows[0];
    if (!row) {
      return null;
    }

    const launchPolicy = resolveConnectorLaunchPolicy(String(row.slug), parseCapabilities(row.capabilities));
    return {
      id: String(row.id),
      tenantKey: String(row.tenantKey),
      connectorId: String(row.connectorId),
      slug: String(row.slug),
      displayName: String(row.displayName),
      accountAlias: String(row.accountAlias),
      externalAccountRef: row.externalAccountRef ? String(row.externalAccountRef) : null,
      status: String(row.status) as ConnectorInstallationRecord["status"],
      capabilities: launchPolicy.surfacedCapabilities,
      implementationStatus: this.resolveImplementationStatus(String(row.slug)),
      launchStage: launchPolicy.launchStage,
      launchNote: launchPolicy.launchNote,
      metadata: parseMetadata(row.metadata),
      installedAt: String(row.installedAt),
      installedBy: String(row.installedBy),
      lastSyncAt: row.lastSyncAt ? String(row.lastSyncAt) : null,
      createdAt: String(row.createdAt),
      updatedAt: String(row.updatedAt),
    };
  }

  async requireInstallation(tenantKey: string, slug: string): Promise<ConnectorInstallationRecord> {
    const installation = await this.getInstallation(tenantKey, slug);
    if (!installation) {
      throw new InstallationNotFoundError(slug);
    }
    if (installation.status === "CREDENTIAL_EXPIRED") {
      throw new CredentialExpiredError(slug);
    }
    return installation;
  }

  async validate(
    installation: ConnectorInstallationRecord,
    product: ProductPayload,
  ): Promise<ValidationResult> {
    const connector = this.registry.getConnector(installation.slug);
    return connector.validateProduct(this.buildContext(installation), product);
  }

  async publish(
    installation: ConnectorInstallationRecord,
    product: ProductPayload,
  ): Promise<SubmissionRef> {
    const connector = this.registry.getConnector(installation.slug);
    if (!installation.capabilities.includes("PUBLISH")) {
      throw new CapabilityNotSupportedError(installation.slug, "PUBLISH");
    }
    if (!connector.publishProduct) {
      throw new CapabilityNotSupportedError(installation.slug, "PUBLISH");
    }
    return connector.publishProduct(this.buildContext(installation), product);
  }

  async update(
    installation: ConnectorInstallationRecord,
    product: ProductPayload,
    externalRef: string,
  ): Promise<SubmissionRef> {
    const connector = this.registry.getConnector(installation.slug);
    if (!installation.capabilities.includes("PUBLISH")) {
      throw new CapabilityNotSupportedError(installation.slug, "PUBLISH");
    }
    if (!connector.updateProduct) {
      throw new CapabilityNotSupportedError(installation.slug, "PUBLISH");
    }
    return connector.updateProduct(this.buildContext(installation), product, externalRef);
  }

  async syncStatus(
    installation: ConnectorInstallationRecord,
    externalRef: string,
  ): Promise<SubmissionStatusUpdate> {
    const connector = this.registry.getConnector(installation.slug);
    if (!installation.capabilities.includes("STATUS_SYNC")) {
      throw new CapabilityNotSupportedError(installation.slug, "STATUS_SYNC");
    }
    if (!connector.syncSubmissionStatus) {
      throw new CapabilityNotSupportedError(installation.slug, "STATUS_SYNC");
    }
    return connector.syncSubmissionStatus(this.buildContext(installation), externalRef);
  }

  async submitOrExport(
    installation: ConnectorInstallationRecord,
    product: ProductPayload,
  ): Promise<
    | { mode: "publish"; submission: SubmissionRef }
    | { mode: "export_only"; completion: "connector_export_only" }
  > {
    if (installation.capabilities.includes("PUBLISH")) {
      return {
        mode: "publish",
        submission: await this.publish(installation, product),
      };
    }
    return this.completeExportOnly(installation);
  }

  buildIdempotencyKey(jobId: string, operation: "PUBLISH" | "EXPORT_ONLY" = "PUBLISH"): string {
    return `${jobId}:${operation}`;
  }

  async recordSubmissionAttempt(input: {
    installation: ConnectorInstallationRecord;
    productId: string;
    variantId?: string | null;
    jobId: string;
    operation: "PUBLISH" | "EXPORT_ONLY";
    source: "LIVE_API" | "LOCAL_RULES" | "NOT_VALIDATED";
    status: "PENDING" | "SUCCESS" | "REJECTED" | "SUPPRESSED" | "ERROR";
    externalRef?: string | null;
    payloadSnapshot: Record<string, unknown>;
    channelErrors?: Record<string, unknown>[] | null;
  }): Promise<{
    id: string;
    idempotencyKey: string;
    attemptNumber: number;
    status: string;
    submissionType: string;
    source: string;
    payloadSnapshotUrl: string | null;
  }> {
    const idempotencyKey = this.buildIdempotencyKey(input.jobId, input.operation);
    const cappedPayload = await this.capPayloadSnapshot(
      input.installation,
      input.jobId,
      input.payloadSnapshot ?? {},
    );
    const channelErrorsJson = JSON.stringify(input.channelErrors ?? []);
    const resolvedAt = ["SUCCESS", "REJECTED", "SUPPRESSED", "ERROR"].includes(input.status)
      ? new Date()
      : null;

    // RLS-BYPASS: manual tenant filter
    const rows = await this.prisma.tenant(input.installation.tenantKey).$queryRawUnsafe<Array<Record<string, unknown>>>(
      `
      INSERT INTO connector_submissions (
        id,
        tenant_key,
        installation_id,
        product_id,
        variant_id,
        idempotency_key,
        submission_type,
        source,
        attempt_number,
        status,
        external_ref,
        payload_snapshot,
        payload_snapshot_url,
        channel_errors,
        submitted_at,
        resolved_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, 1, $9, $10, $11::jsonb, $12, $13::jsonb, NOW(), $14
      )
      ON CONFLICT (tenant_key, installation_id, idempotency_key) DO UPDATE
      SET
        attempt_number = connector_submissions.attempt_number + 1,
        status = EXCLUDED.status,
        external_ref = COALESCE(EXCLUDED.external_ref, connector_submissions.external_ref),
        payload_snapshot = EXCLUDED.payload_snapshot,
        payload_snapshot_url = EXCLUDED.payload_snapshot_url,
        channel_errors = EXCLUDED.channel_errors,
        resolved_at = CASE
          WHEN EXCLUDED.status IN ('SUCCESS', 'REJECTED', 'SUPPRESSED', 'ERROR') THEN NOW()
          ELSE connector_submissions.resolved_at
        END
      RETURNING
        id,
        idempotency_key AS "idempotencyKey",
        attempt_number AS "attemptNumber",
        status,
        submission_type AS "submissionType",
        source,
        payload_snapshot_url AS "payloadSnapshotUrl"
      `,
      randomUUID(),
      input.installation.tenantKey,
      input.installation.id,
      input.productId,
      input.variantId ?? null,
      idempotencyKey,
      input.operation,
      input.source,
      input.status,
      input.externalRef ?? null,
      cappedPayload.snapshotJson,
      cappedPayload.payloadSnapshotUrl,
      channelErrorsJson,
      resolvedAt,
    );

    const row = rows[0];
    return {
      id: String(row.id),
      idempotencyKey: String(row.idempotencyKey),
      attemptNumber: Number(row.attemptNumber),
      status: String(row.status),
      submissionType: String(row.submissionType),
      source: String(row.source),
      payloadSnapshotUrl:
        row.payloadSnapshotUrl === null || row.payloadSnapshotUrl === undefined
          ? null
          : String(row.payloadSnapshotUrl),
    };
  }

  getCurrentTenantKey(): string {
    return getTenantKeyFromContext();
  }

  private completeExportOnly(installation: ConnectorInstallationRecord): {
    mode: "export_only";
    completion: "connector_export_only";
  } {
    if (!installation.capabilities.includes("EXCEL_EXPORT")) {
      throw new CapabilityNotSupportedError(installation.slug, "PUBLISH");
    }
    return {
      mode: "export_only",
      completion: "connector_export_only",
    };
  }

  private buildContext(installation: ConnectorInstallationRecord): ConnectorContext {
    return {
      tenantId: installation.tenantKey,
      installationId: installation.id,
      connectorId: installation.connectorId,
      marketplaceId: installation.metadata.marketplaceId as string | undefined,
      sellerId: installation.metadata.sellerId as string | undefined,
      getAccessToken: async () => "",
    };
  }

  private async capPayloadSnapshot(
    installation: ConnectorInstallationRecord,
    jobId: string,
    payloadSnapshot: Record<string, unknown>,
  ): Promise<{ snapshotJson: string; payloadSnapshotUrl: string | null }> {
    const rawSnapshotJson = JSON.stringify(payloadSnapshot ?? {});
    const sizeBytes = Buffer.byteLength(rawSnapshotJson, "utf8");
    if (sizeBytes <= PAYLOAD_SNAPSHOT_CAP_BYTES) {
      return {
        snapshotJson: rawSnapshotJson,
        payloadSnapshotUrl: null,
      };
    }

    const safeTenant = installation.tenantKey.replace(/[^a-zA-Z0-9._-]+/g, "_");
    const safeJobId = jobId.replace(/[^a-zA-Z0-9._-]+/g, "_");
    const relativePath = path.join("submissions", safeTenant, `${safeJobId}-payload.json`);
    const storagePath = path.join(process.cwd(), "storage", relativePath);
    await fs.mkdir(path.dirname(storagePath), { recursive: true });
    await fs.writeFile(storagePath, rawSnapshotJson, "utf8");

    const publicBase = String(process.env.R2_PUBLIC_URL ?? "").trim().replace(/\/+$/, "");
    const normalizedRelative = relativePath.replace(/\\/g, "/");
    const payloadSnapshotUrl = publicBase
      ? `${publicBase}/${normalizedRelative}`
      : storagePath;

    return {
      snapshotJson: JSON.stringify({
        truncated: true,
        originalSizeBytes: sizeBytes,
        snapshotUrl: payloadSnapshotUrl,
      }),
      payloadSnapshotUrl,
    };
  }
}
