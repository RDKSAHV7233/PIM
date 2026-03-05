// apps/api/src/marketplace/marketplace.service.ts (processExportJob only)
// Existing endpoint and DTO preserved — only implementation changes.
// Applied: capability branch guard (R8), stable idempotencyKey (R5)

import { Injectable, Logger } from '@nestjs/common';
import { ConnectorCap } from '@prisma/client';
import { ConnectorFrameworkService } from '../connector-framework/connector-framework.service';
import { PrismaService } from '../prisma/prisma.service'; // adjust path to your prisma service

@Injectable()
export class MarketplaceService {
  private readonly logger = new Logger(MarketplaceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly connectorFramework: ConnectorFrameworkService,
  ) {}

  async processExportJob(jobId: string): Promise<void> {
    const job = await this.prisma.tenant().marketplaceExportJob
      .findUniqueOrThrow({ where: { id: jobId } });

    const installation = await this.connectorFramework
      .requireInstallation(job.tenantId, job.channel);

    const product = await this.buildProductPayload(job.productId);

    // Step 1: validate (non-destructive — safe to call repeatedly)
    const validation = await this.connectorFramework
      .validate(installation, product);

    if (!validation.isValid) {
      return this.failJob(jobId, validation.errors);
    }

    // Step 2: branch on connector capability
    // R8: check capability before calling publish — Meesho has no publishProduct()
    const canPublish = installation.capabilities.includes(ConnectorCap.PUBLISH);

    if (!canPublish) {
      // Export-only path (Meesho and any future export-only connectors)
      return this.completeExportOnly(jobId, installation, product);
    }

    // Step 3: publish (Amazon, Flipkart)
    const submission = await this.connectorFramework
      .publish(installation, product);

    // Step 4: record authoritative submission
    // R5: idempotencyKey is stable across retries — format ${jobId}:PUBLISH
    // Do NOT use ${job.id}:${job.attemptNumber} — that changes on every retry
    const idempotencyKey = `${job.id}:PUBLISH`;

    try {
      await this.prisma.tenant().connectorSubmission.create({
        data: {
          tenantId: job.tenantId,
          installationId: installation.id,
          productId: job.productId,
          idempotencyKey,
          submissionType: 'PUBLISH',
          source: 'MANUAL',
          attemptNumber: job.attemptNumber ?? 1,
          status: submission.status,
          externalRef: submission.externalRef ?? null,
          payloadSnapshot: product,
          // GOVERNANCE: payloadSnapshot may contain PII.
          // Redact after 90 days, purge after 365 days. Do not log.
        },
      });
    } catch (error: unknown) {
      // If unique constraint violation → idempotency enforced → return existing record
      if (this.isUniqueConstraintError(error)) {
        this.logger.log({
          message: 'Idempotent re-submission detected — returning existing record',
          idempotencyKey,
          tenantId: job.tenantId,
          connectorSlug: job.channel,
        });
        return this.completeJob(jobId, submission);
      }
      throw error;
    }

    return this.completeJob(jobId, submission);
  }

  private async completeExportOnly(
    jobId: string,
    installation: { id: string; capabilities: ConnectorCap[] },
    product: any, // ProductPayload
  ): Promise<void> {
    // TODO P5-S4: call connectorFramework.generateExportFile(installation, [product])
    // Return download URL for seller — store in MarketplaceExportJob.resultUrl or similar
    // Record ConnectorSubmission with submissionType: EXPORT_FILE
    throw new Error('completeExportOnly not yet implemented (P5-S4)');
  }

  private async failJob(jobId: string, errors: unknown[]): Promise<void> {
    // TODO: update MarketplaceExportJob status to FAILED, store errors
    this.logger.error({ message: 'Export job failed validation', jobId, errors });
  }

  private async completeJob(jobId: string, submission: unknown): Promise<void> {
    // TODO: update MarketplaceExportJob status to COMPLETED
    this.logger.log({ message: 'Export job completed', jobId });
  }

  private async buildProductPayload(productId: string): Promise<any> {
    // TODO: load Product + Variant + MediaAsset from Prisma, map to ProductPayload
    // Ensure mainImageUrl = MediaAsset.cdnUrl (permanent HTTPS URL)
    throw new Error('buildProductPayload not yet implemented');
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      error instanceof Error &&
      'code' in error &&
      (error as any).code === 'P2002'
    );
  }
}
