import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { LoggerService } from "../common/logging/logger.service";
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
    private readonly logger: LoggerService,
  ) {}

  private resolveImplementationStatus(slug: string): ConnectorImplementationStatus {
    try {
      return this.registry.getConnector(slug).implementationStatus ?? "stub";
    } catch {
      return "stub";
    }
  }

  async getInstallation(tenantKey: string, slug: string, installationId?: string): Promise<ConnectorInstallationRecord | null> {
    const connectorDefinition = await this.prisma.tenant(tenantKey).connectorDefinition.findFirst({
      where: { slug },
      select: {
        id: true,
        slug: true,
        displayName: true,
        capabilities: true,
      },
    });
    if (!connectorDefinition) {
      return null;
    }

    const installationCount = await this.prisma.tenant(tenantKey).connectorInstallation.count({
      where: { connectorId: connectorDefinition.id, status: { not: "DISABLED" } },
    });
    if (installationCount > 1 && !installationId) {
      this.logger.warn(
        "Multiple active installations found for connector; using most recently installed.",
        { slug: connectorDefinition.slug, count: installationCount },
      );
    }

    const installation = await this.prisma.tenant(tenantKey).connectorInstallation.findFirst({
      where: { connectorId: connectorDefinition.id, ...(installationId ? { id: installationId } : {}) },
      orderBy: [{ installedAt: "desc" }],
      select: {
        id: true,
        tenantKey: true,
        connectorId: true,
        accountAlias: true,
        externalAccountRef: true,
        status: true,
        metadata: true,
        installedAt: true,
        installedBy: true,
        lastSyncAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!installation) {
      return null;
    }

    const launchPolicy = resolveConnectorLaunchPolicy(connectorDefinition.slug, parseCapabilities(connectorDefinition.capabilities));
    return {
      id: installation.id,
      tenantKey: installation.tenantKey,
      connectorId: installation.connectorId,
      slug: connectorDefinition.slug,
      displayName: connectorDefinition.displayName,
      accountAlias: installation.accountAlias,
      externalAccountRef: installation.externalAccountRef,
      status: installation.status as ConnectorInstallationRecord["status"],
      capabilities: launchPolicy.surfacedCapabilities,
      implementationStatus: this.resolveImplementationStatus(connectorDefinition.slug),
      launchStage: launchPolicy.launchStage,
      launchNote: launchPolicy.launchNote,
      metadata: parseMetadata(installation.metadata),
      installedAt: installation.installedAt.toISOString(),
      installedBy: installation.installedBy,
      lastSyncAt: installation.lastSyncAt ? installation.lastSyncAt.toISOString() : null,
      createdAt: installation.createdAt.toISOString(),
      updatedAt: installation.updatedAt.toISOString(),
    };
  }

  async requireInstallation(tenantKey: string, slug: string, installationId?: string): Promise<ConnectorInstallationRecord> {
    const installation = await this.getInstallation(tenantKey, slug, installationId);
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
    const payloadSnapshot = JSON.parse(cappedPayload.snapshotJson) as Prisma.InputJsonValue;
    const channelErrors = (input.channelErrors ?? []) as Prisma.InputJsonValue;
    const resolvedAt = ["SUCCESS", "REJECTED", "SUPPRESSED", "ERROR"].includes(input.status)
      ? new Date()
      : null;

    const row = await this.prisma.tenant(input.installation.tenantKey).connectorSubmission.upsert({
      where: {
        tenantKey_installationId_idempotencyKey: {
          tenantKey: input.installation.tenantKey,
          installationId: input.installation.id,
          idempotencyKey,
        },
      },
      create: {
        id: randomUUID(),
        installationId: input.installation.id,
        productId: input.productId,
        variantId: input.variantId ?? null,
        idempotencyKey,
        submissionType: input.operation,
        source: input.source,
        attemptNumber: 1,
        status: input.status,
        externalRef: input.externalRef ?? null,
        payloadSnapshot,
        payloadSnapshotUrl: cappedPayload.payloadSnapshotUrl,
        channelErrors,
        resolvedAt,
      },
      update: {
        attemptNumber: {
          increment: 1,
        },
        status: input.status,
        ...(input.externalRef ? { externalRef: input.externalRef } : {}),
        payloadSnapshot,
        payloadSnapshotUrl: cappedPayload.payloadSnapshotUrl,
        channelErrors,
        ...(resolvedAt ? { resolvedAt } : {}),
      },
      select: {
        id: true,
        idempotencyKey: true,
        attemptNumber: true,
        status: true,
        submissionType: true,
        source: true,
        payloadSnapshotUrl: true,
      },
    });

    return {
      id: row.id,
      idempotencyKey: row.idempotencyKey,
      attemptNumber: row.attemptNumber,
      status: row.status,
      submissionType: row.submissionType,
      source: row.source,
      payloadSnapshotUrl:
        row.payloadSnapshotUrl === null || row.payloadSnapshotUrl === undefined
          ? null
          : row.payloadSnapshotUrl,
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
