import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { LoggerService } from "../common/logging/logger.service";
import type {
  ErrorAuthorityIssueListItem,
  ErrorAuthorityListResponse,
  ErrorAuthorityOccurrenceListItem,
} from "./error-authority-ops.service";
import type { ErrorEventStore, NormalizedErrorEvent } from "./error-authority.types";

type ErrorAuthorityCursor = {
  at: string;
  id: string;
};

type ListErrorIssuesInput = {
  runtime?: string;
  service?: string;
  severity?: string;
  state?: string;
  release?: string;
  errorCode?: string;
  route?: string;
  dateFrom: Date;
  dateTo: Date;
  cursor?: ErrorAuthorityCursor;
  limit: number;
  encodeCursor(payload: ErrorAuthorityCursor): string;
};

type ListErrorOccurrencesInput = {
  issueId: string;
  dateFrom: Date;
  dateTo: Date;
  cursor?: ErrorAuthorityCursor;
  limit: number;
  encodeCursor(payload: ErrorAuthorityCursor): string;
};

type ErrorIssueRow = {
  id: string;
  fingerprint: string;
  runtime: string;
  service: string;
  environment: string;
  errorCode: string | null;
  category: string;
  severity: string;
  state: string;
  safeTitle: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  firstSeenRelease: string | null;
  lastSeenRelease: string | null;
  occurrenceCount: number;
  affectedTenantCount: number;
  latestOccurrenceId: string | null;
};

type ErrorOccurrenceRow = {
  id: string;
  issueId: string;
  occurredAt: Date;
  environment: string;
  release: string | null;
  runtime: string;
  service: string;
  requestId: string | null;
  correlationId: string | null;
  routeTemplate: string | null;
  method: string | null;
  statusCode: number | null;
  safeTenantRef: string | null;
  actorType: string | null;
  jobId: string | null;
  operationId: string | null;
  installationId: string | null;
  errorCode: string | null;
  category: string;
  safeMessage: string;
  topFrameFile: string | null;
  topFrameFunction: string | null;
  topFrameLine: number | null;
  sourceEventId: string | null;
};

type ObservabilityPrismaClient = {
  $connect(): Promise<void>;
  $disconnect(): Promise<void>;
  $transaction<T>(fn: (client: ObservabilityPrismaClient) => Promise<T>): Promise<T>;
  errorOccurrence: {
    findUnique(args: unknown): Promise<unknown>;
    findMany(args: unknown): Promise<ErrorOccurrenceRow[]>;
    create(args: unknown): Promise<{ id: string }>;
  };
  errorIssue: {
    findMany(args: unknown): Promise<ErrorIssueRow[]>;
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

  async listErrorIssues(input: ListErrorIssuesInput): Promise<ErrorAuthorityListResponse<ErrorAuthorityIssueListItem>> {
    if (!this.client) {
      return emptyResponse<ErrorAuthorityIssueListItem>(input);
    }

    const where: Record<string, unknown> = {
      environment: String(process.env.APP_ENV ?? process.env.NODE_ENV ?? "development"),
      lastSeenAt: {
        gte: input.dateFrom,
        lte: input.dateTo,
      },
    };
    if (input.runtime) {
      where.runtime = input.runtime;
    }
    if (input.service) {
      where.service = input.service;
    }
    if (input.severity) {
      where.severity = input.severity;
    }
    if (input.state) {
      where.state = input.state;
    }
    if (input.release) {
      where.lastSeenRelease = input.release;
    }
    if (input.errorCode) {
      where.errorCode = input.errorCode;
    }
    if (input.route) {
      where.occurrences = {
        some: {
          routeTemplate: input.route,
        },
      };
    }
    if (input.cursor) {
      where.OR = [
        { lastSeenAt: { lt: new Date(input.cursor.at) } },
        { lastSeenAt: new Date(input.cursor.at), id: { lt: input.cursor.id } },
      ];
    }

    const rows = await this.client.errorIssue.findMany({
      where,
      orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      select: {
        id: true,
        fingerprint: true,
        runtime: true,
        service: true,
        environment: true,
        errorCode: true,
        category: true,
        severity: true,
        state: true,
        safeTitle: true,
        firstSeenAt: true,
        lastSeenAt: true,
        firstSeenRelease: true,
        lastSeenRelease: true,
        occurrenceCount: true,
        affectedTenantCount: true,
        latestOccurrenceId: true,
      },
    });

    const pageRows = rows.slice(0, input.limit);
    const last = pageRows.at(-1);
    return {
      items: pageRows.map(mapIssueRow),
      limit: input.limit,
      nextCursor:
        rows.length > input.limit && last
          ? input.encodeCursor({ at: last.lastSeenAt.toISOString(), id: last.id })
          : null,
      storageAvailable: true,
      window: {
        dateFrom: input.dateFrom.toISOString(),
        dateTo: input.dateTo.toISOString(),
      },
    };
  }

  async listErrorOccurrences(
    input: ListErrorOccurrencesInput,
  ): Promise<ErrorAuthorityListResponse<ErrorAuthorityOccurrenceListItem>> {
    if (!this.client) {
      return emptyResponse<ErrorAuthorityOccurrenceListItem>(input);
    }

    const where: Record<string, unknown> = {
      issueId: input.issueId,
      occurredAt: {
        gte: input.dateFrom,
        lte: input.dateTo,
      },
    };
    if (input.cursor) {
      where.OR = [
        { occurredAt: { lt: new Date(input.cursor.at) } },
        { occurredAt: new Date(input.cursor.at), id: { lt: input.cursor.id } },
      ];
    }

    const rows = await this.client.errorOccurrence.findMany({
      where,
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      take: input.limit + 1,
      select: {
        id: true,
        issueId: true,
        occurredAt: true,
        environment: true,
        release: true,
        runtime: true,
        service: true,
        requestId: true,
        correlationId: true,
        routeTemplate: true,
        method: true,
        statusCode: true,
        safeTenantRef: true,
        actorType: true,
        jobId: true,
        operationId: true,
        installationId: true,
        errorCode: true,
        category: true,
        safeMessage: true,
        topFrameFile: true,
        topFrameFunction: true,
        topFrameLine: true,
        sourceEventId: true,
      },
    });

    const pageRows = rows.slice(0, input.limit);
    const last = pageRows.at(-1);
    return {
      items: pageRows.map(mapOccurrenceRow),
      limit: input.limit,
      nextCursor:
        rows.length > input.limit && last
          ? input.encodeCursor({ at: last.occurredAt.toISOString(), id: last.id })
          : null,
      storageAvailable: true,
      window: {
        dateFrom: input.dateFrom.toISOString(),
        dateTo: input.dateTo.toISOString(),
      },
    };
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

function emptyResponse<T>(input: { limit: number; dateFrom: Date; dateTo: Date }): ErrorAuthorityListResponse<T> {
  return {
    items: [],
    limit: input.limit,
    nextCursor: null,
    storageAvailable: false,
    window: {
      dateFrom: input.dateFrom.toISOString(),
      dateTo: input.dateTo.toISOString(),
    },
  };
}

function mapIssueRow(row: ErrorIssueRow): ErrorAuthorityIssueListItem {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    runtime: row.runtime,
    service: row.service,
    environment: row.environment,
    errorCode: row.errorCode,
    category: row.category,
    severity: row.severity,
    state: row.state,
    safeTitle: row.safeTitle,
    firstSeenAt: row.firstSeenAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    firstSeenRelease: row.firstSeenRelease,
    lastSeenRelease: row.lastSeenRelease,
    occurrenceCount: row.occurrenceCount,
    affectedTenantCount: row.affectedTenantCount,
    latestOccurrenceId: row.latestOccurrenceId,
  };
}

function mapOccurrenceRow(row: ErrorOccurrenceRow): ErrorAuthorityOccurrenceListItem {
  return {
    id: row.id,
    issueId: row.issueId,
    occurredAt: row.occurredAt.toISOString(),
    environment: row.environment,
    release: row.release,
    runtime: row.runtime,
    service: row.service,
    requestId: row.requestId,
    correlationId: row.correlationId,
    routeTemplate: row.routeTemplate,
    method: row.method,
    statusCode: row.statusCode,
    safeTenantRef: row.safeTenantRef,
    actorType: row.actorType,
    jobId: row.jobId,
    operationId: row.operationId,
    installationId: row.installationId,
    errorCode: row.errorCode,
    category: row.category,
    safeMessage: row.safeMessage,
    topFrameFile: row.topFrameFile,
    topFrameFunction: row.topFrameFunction,
    topFrameLine: row.topFrameLine,
    sourceEventId: row.sourceEventId,
  };
}
