import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { LoggerService } from "../common/logging/logger.service";
import type { ErrorEventStore, NormalizedErrorEvent } from "./error-authority.types";

type ObservabilityPrismaClient = {
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
  $transaction<T>(fn: (client: ObservabilityPrismaClient) => Promise<T>): Promise<T>;
  errorOccurrence: {
    findUnique(args: unknown): Promise<unknown>;
    create(args: unknown): Promise<{ id: string }>;
  };
  errorIssue: {
    upsert(args: unknown): Promise<{ id: string }>;
    update(args: unknown): Promise<unknown>;
  };
  errorIssueTenantImpact: {
    findUnique(args: unknown): Promise<unknown>;
    upsert(args: unknown): Promise<unknown>;
  };
};

@Injectable()
export class ObservabilityDbService implements ErrorEventStore, OnModuleInit, OnModuleDestroy {
  private client: ObservabilityPrismaClient | null = null;
  private readonly enabled = String(process.env.ERROR_AUTHORITY_ENABLED ?? "false").trim().toLowerCase() === "true";
  private readonly databaseUrl = String(process.env.OBSERVABILITY_DATABASE_URL ?? "").trim();

  constructor(private readonly logger: LoggerService) {}

  async onModuleInit() {
    if (!this.enabled) {
      return;
    }
    if (!this.databaseUrl) {
      this.logger.warn("Error authority enabled without observability database URL; capture will fail open.");
      return;
    }
    try {
      const imported = await import("@pim1/observability-db/generated/client");
      const PrismaClient = imported.PrismaClient as unknown as new (args: unknown) => ObservabilityPrismaClient;
      this.client = new PrismaClient({
        datasources: {
          db: {
            url: this.withApplicationName(this.databaseUrl),
          },
        },
      });
      await this.client.$connect();
    } catch (error: unknown) {
      this.client = null;
      this.logger.error("Observability database initialization failed; capture will fail open.", {
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async onModuleDestroy() {
    if (this.client) {
      await this.client.$disconnect();
      this.client = null;
    }
  }

  async record(event: NormalizedErrorEvent): Promise<void> {
    if (!this.client) {
      this.logger.warn("Error authority capture skipped because observability storage is unavailable.", {
        runtime: event.runtime,
        service: event.service,
        fingerprint: event.fingerprint,
      });
      return;
    }
    try {
      await this.client.$transaction(async (tx) => {
        if (event.sourceEventId) {
          const existing = await tx.errorOccurrence.findUnique({
            where: { sourceEventId: event.sourceEventId },
            select: { id: true },
          });
          if (existing) {
            return;
          }
        }

        const issue = await tx.errorIssue.upsert({
          where: {
            environment_runtime_service_fingerprintVersion_fingerprint: {
              environment: event.environment,
              runtime: event.runtime,
              service: event.service,
              fingerprintVersion: event.fingerprintVersion,
              fingerprint: event.fingerprint,
            },
          },
          create: {
            environment: event.environment,
            runtime: event.runtime,
            service: event.service,
            fingerprintVersion: event.fingerprintVersion,
            fingerprint: event.fingerprint,
            errorCode: event.errorCode,
            category: event.category,
            safeTitle: event.safeTitle,
            severity: event.severity,
            firstSeenAt: event.occurredAt,
            lastSeenAt: event.occurredAt,
            firstSeenRelease: event.release,
            lastSeenRelease: event.release,
            occurrenceCount: 1,
          },
          update: {
            lastSeenAt: event.occurredAt,
            lastSeenRelease: event.release,
            occurrenceCount: { increment: 1 },
          },
          select: { id: true },
        });

        const occurrence = await tx.errorOccurrence.create({
          data: {
            issueId: issue.id,
            occurredAt: event.occurredAt,
            environment: event.environment,
            release: event.release,
            runtime: event.runtime,
            service: event.service,
            requestId: event.requestId,
            correlationId: event.correlationId,
            routeTemplate: event.routeTemplate,
            method: event.method,
            statusCode: event.statusCode,
            safeTenantRef: event.safeTenantRef,
            safeActorRef: event.safeActorRef,
            actorType: event.actorType,
            jobId: event.jobId,
            operationId: event.operationId,
            installationId: event.installationId,
            errorCode: event.errorCode,
            category: event.category,
            safeMessage: event.safeMessage,
            topFrameFile: event.topFrameFile,
            topFrameFunction: event.topFrameFunction,
            topFrameLine: event.topFrameLine,
            normalizedFrames: event.normalizedFrames,
            stackHash: event.stackHash,
            sourceEventId: event.sourceEventId,
          },
          select: { id: true },
        });

        let shouldIncrementTenantImpact = false;
        if (event.safeTenantRef) {
          const existingTenantImpact = await tx.errorIssueTenantImpact.findUnique({
            where: {
              issueId_safeTenantRef: {
                issueId: issue.id,
                safeTenantRef: event.safeTenantRef,
              },
            },
            select: { id: true },
          });
          shouldIncrementTenantImpact = !existingTenantImpact;
          await tx.errorIssueTenantImpact.upsert({
            where: {
              issueId_safeTenantRef: {
                issueId: issue.id,
                safeTenantRef: event.safeTenantRef,
              },
            },
            create: {
              issueId: issue.id,
              safeTenantRef: event.safeTenantRef,
              firstSeenAt: event.occurredAt,
              lastSeenAt: event.occurredAt,
            },
            update: {
              lastSeenAt: event.occurredAt,
            },
          });
        }

        await tx.errorIssue.update({
          where: { id: issue.id },
          data: {
            latestOccurrenceId: occurrence.id,
            ...(shouldIncrementTenantImpact ? { affectedTenantCount: { increment: 1 } } : {}),
          },
        });
      });
    } catch (error: unknown) {
      this.logger.error("Error authority capture failed open.", {
        runtime: event.runtime,
        service: event.service,
        fingerprint: event.fingerprint,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private withApplicationName(databaseUrl: string): string {
    const appName =
      encodeURIComponent(String(process.env.OBSERVABILITY_DB_POOL_APP_NAME ?? "vexa-error-authority").trim()) ||
      "vexa-error-authority";
    if (databaseUrl.includes("application_name=")) {
      return databaseUrl;
    }
    return databaseUrl.includes("?") ? `${databaseUrl}&application_name=${appName}` : `${databaseUrl}?application_name=${appName}`;
  }
}
