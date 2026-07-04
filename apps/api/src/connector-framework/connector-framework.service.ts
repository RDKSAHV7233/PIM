import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { LoggerService } from "../common/logging/logger.service";
import { getTenantKeyFromContext } from "../common/tenant/tenant-context";
import { PrismaService } from "../prisma/prisma.service";
import {
  CapabilityNotSupportedError,
  CredentialExpiredError,
  InstallationNotFoundError,
} from "./connector.errors";
import { ConnectorCredentialService } from "./connector-credential.service";
import { ConnectorHttpClient } from "./connector-http-client.service";
import { ConnectorSubmissionStorageService } from "./connector-submission-storage.service";
import {
  BulkSubmissionRef,
  ConnectorCap,
  ConnectorContext,
  ConnectorImplementationStatus,
  ExportFile,
  ProductPayload,
  SubmissionRef,
  SubmissionStatusUpdate,
  ValidationResult,
} from "./connector.interface";
import { resolveConnectorLaunchPolicy } from "./connector-launch-policy";
import { ConnectorRegistry } from "./connector.registry";
import { ConnectorInstallationRecord } from "./connector.types";
import { parseCapabilities } from "./parse-capabilities";
import { lookupAmazonMarketplace } from "../connectors/amazon/amazon-marketplace-registry";

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
    private readonly credentialService: ConnectorCredentialService,
    private readonly httpClient: ConnectorHttpClient,
    private readonly snapshotStorage: ConnectorSubmissionStorageService,
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
      where: {
        connectorId: connectorDefinition.id,
        status: { not: "DISABLED" },
        ...(installationId ? { id: installationId } : {}),
      },
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
    const started = Date.now();
    try {
      const result = await connector.validateProduct(this.buildContext(installation), product);
      this.logger.info("connector.validate.completed", {
        slug: installation.slug,
        tenantKey: installation.tenantKey,
        isValid: result.isValid,
        errorCount: result.errors.length,
        source: result.source,
        durationMs: Date.now() - started,
      });
      return result;
    } catch (err) {
      this.logger.warn("connector.validate.failed", {
        slug: installation.slug,
        tenantKey: installation.tenantKey,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - started,
      });
      throw err;
    }
  }

  async publish(
    installation: ConnectorInstallationRecord,
    product: ProductPayload,
  ): Promise<SubmissionRef> {
    const connector = this.registry.getConnector(installation.slug);
    if (!installation.capabilities.includes("PUBLISH")) {
      throw new CapabilityNotSupportedError(installation.slug, "PUBLISH");
    }
    if (installation.implementationStatus === "stub") {
      throw new CapabilityNotSupportedError(installation.slug, "PUBLISH");
    }
    if (!connector.publishProduct) {
      throw new CapabilityNotSupportedError(installation.slug, "PUBLISH");
    }
    const started = Date.now();
    this.logger.info("connector.publish.attempt", {
      slug: installation.slug,
      tenantKey: installation.tenantKey,
      sku: product.sku,
    });
    try {
      const result = await connector.publishProduct(this.buildContext(installation), product);
      this.logger.info("connector.publish.success", {
        slug: installation.slug,
        tenantKey: installation.tenantKey,
        sku: product.sku,
        externalRef: result.externalRef,
        status: result.status,
        isAsync: result.isAsync,
        durationMs: Date.now() - started,
      });
      return result;
    } catch (err) {
      this.logger.warn("connector.publish.failure", {
        slug: installation.slug,
        tenantKey: installation.tenantKey,
        sku: product.sku,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - started,
      });
      throw err;
    }
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
    const started = Date.now();
    this.logger.info("connector.update.attempt", {
      slug: installation.slug,
      tenantKey: installation.tenantKey,
      sku: product.sku,
      externalRef,
    });
    try {
      const result = await connector.updateProduct(this.buildContext(installation), product, externalRef);
      this.logger.info("connector.update.success", {
        slug: installation.slug,
        tenantKey: installation.tenantKey,
        sku: product.sku,
        durationMs: Date.now() - started,
      });
      return result;
    } catch (err) {
      this.logger.warn("connector.update.failure", {
        slug: installation.slug,
        tenantKey: installation.tenantKey,
        sku: product.sku,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - started,
      });
      throw err;
    }
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

  async publishBulk(
    installation: ConnectorInstallationRecord,
    products: ProductPayload[],
  ): Promise<BulkSubmissionRef> {
    const connector = this.registry.getConnector(installation.slug);
    if (!installation.capabilities.includes("BULK_PUBLISH")) {
      throw new CapabilityNotSupportedError(installation.slug, "BULK_PUBLISH");
    }
    if (!connector.publishBulkProducts) {
      throw new CapabilityNotSupportedError(installation.slug, "BULK_PUBLISH");
    }
    const started = Date.now();
    this.logger.info("connector.bulk_publish.attempt", {
      slug: installation.slug,
      tenantKey: installation.tenantKey,
      productCount: products.length,
    });
    try {
      const result = await connector.publishBulkProducts(this.buildContext(installation), products);
      this.logger.info("connector.bulk_publish.success", {
        slug: installation.slug,
        tenantKey: installation.tenantKey,
        feedId: result.feedId,
        productCount: result.productCount,
        durationMs: Date.now() - started,
      });
      return result;
    } catch (err) {
      this.logger.warn("connector.bulk_publish.failure", {
        slug: installation.slug,
        tenantKey: installation.tenantKey,
        productCount: products.length,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - started,
      });
      throw err;
    }
  }

  async exportProducts(
    installation: ConnectorInstallationRecord,
    products: ProductPayload[],
  ): Promise<ExportFile> {
    const connector = this.registry.getConnector(installation.slug);
    if (!installation.capabilities.includes("EXCEL_EXPORT")) {
      throw new CapabilityNotSupportedError(installation.slug, "EXCEL_EXPORT");
    }
    if (!connector.generateExportFile) {
      throw new CapabilityNotSupportedError(installation.slug, "EXCEL_EXPORT");
    }
    return connector.generateExportFile(this.buildContext(installation), products);
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
    const metadata = installation.metadata;

    // ── Marketplace context ───────────────────────────────────────────────────
    // Derive marketCode + currencyCode from two sources (registry wins for Amazon):
    //   1. Amazon registry: marketplaceId → entry (covers all Amazon global stores)
    //   2. Installation metadata: marketCode / currencyCode written at OAuth time
    //      (set by Shopify connector after fetching shop.countryCode / shop.currencyCode)
    const marketplaceId = metadata.marketplaceId as string | undefined;
    const registryEntry = marketplaceId ? lookupAmazonMarketplace(marketplaceId) : undefined;
    const marketCode =
      registryEntry?.marketCode ??
      (metadata.marketCode as string | undefined);
    const currencyCode =
      registryEntry?.currencyCode ??
      (metadata.currencyCode as string | undefined);

    // ctx is defined as const so closures can reference it safely after construction
    const ctx: ConnectorContext = {
      tenantId: installation.tenantKey,
      installationId: installation.id,
      connectorId: installation.connectorId,
      marketplaceId,
      sellerId: metadata.sellerId as string | undefined,
      marketCode,
      currencyCode,
      getAccessToken: async () => {
        const connector = this.registry.getConnector(installation.slug);
        return this.credentialService.getOrRefreshAccessToken(
          installation.tenantKey,
          installation.id,
          installation.slug,
          async () => {
            if (!connector.refreshAccessToken) {
              throw new Error(
                `Connector '${installation.slug}' does not implement refreshAccessToken. ` +
                `Add refreshAccessToken() to the connector or set up a static access token.`,
              );
            }
            return connector.refreshAccessToken(ctx);
          },
        );
      },
      fetch: (url, init) =>
        this.httpClient.fetch(installation.slug, installation.id, url, init),
    };
    return ctx;
  }

  private async capPayloadSnapshot(
    installation: ConnectorInstallationRecord,
    jobId: string,
    payloadSnapshot: Record<string, unknown>,
  ): Promise<{ snapshotJson: string; payloadSnapshotUrl: string | null }> {
    const rawSnapshotJson = JSON.stringify(payloadSnapshot ?? {});
    const sizeBytes = Buffer.byteLength(rawSnapshotJson, "utf8");

    // Under the cap: store inline in DB, no external storage needed.
    if (sizeBytes <= PAYLOAD_SNAPSHOT_CAP_BYTES) {
      return { snapshotJson: rawSnapshotJson, payloadSnapshotUrl: null };
    }

    // Over the cap: upload to R2 (or local FS in dev) and store the access URL.
    try {
      const { accessUrl } = await this.snapshotStorage.storeSnapshot({
        tenantKey: installation.tenantKey,
        jobId,
        content: rawSnapshotJson,
      });

      return {
        snapshotJson: JSON.stringify({
          truncated: true,
          originalSizeBytes: sizeBytes,
          snapshotUrl: accessUrl,
        }),
        payloadSnapshotUrl: accessUrl,
      };
    } catch (err) {
      // Storage failure is non-fatal — store a truncated inline snapshot rather
      // than blocking the submission record. Engineers can request a re-publish
      // to get a fresh snapshot if needed.
      this.logger.warn("connector.snapshot.upload_failed", {
        tenantKey: installation.tenantKey,
        jobId,
        originalSizeBytes: sizeBytes,
        error: err instanceof Error ? err.message : String(err),
      });
      const truncated = rawSnapshotJson.slice(0, PAYLOAD_SNAPSHOT_CAP_BYTES);
      return {
        snapshotJson: JSON.stringify({
          truncated: true,
          originalSizeBytes: sizeBytes,
          uploadFailed: true,
          partialSnapshot: JSON.parse(truncated.endsWith("}") ? truncated : truncated + '"..."}'),
        }),
        payloadSnapshotUrl: null,
      };
    }
  }
}
