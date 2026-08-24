import { Injectable, Optional } from "@nestjs/common";
import { resolveErrorAuthorityRelease } from "../common/error-authority-env";
import { getCorrelationContext } from "../common/logging/correlation-context";
import { LoggerService } from "../common/logging/logger.service";
import { getTenantKeyFromContext } from "../common/tenant/tenant-context";
import { InternalOpsAlertsService } from "../internal-ops/internal-ops-alerts.service";
import type { ErrorCaptureInput, ErrorEventStore, ErrorRecordResult, NormalizedErrorEvent } from "./error-authority.types";
import { normalizeErrorEvent } from "./error-fingerprint";
import { ObservabilityDbService } from "./observability-db.service";

@Injectable()
export class ErrorCaptureService {
  private readonly refSecret = String(process.env.ERROR_AUTHORITY_REF_SECRET ?? "").trim();

  constructor(
    private readonly store: ObservabilityDbService,
    private readonly logger: LoggerService,
    @Optional() private readonly internalOpsAlertsService?: InternalOpsAlertsService,
  ) {}

  async captureUnexpected(input: Omit<ErrorCaptureInput, "environment" | "correlationId">): Promise<void> {
    const event = normalizeErrorEvent(
      {
        ...input,
        environment: String(process.env.APP_ENV ?? process.env.NODE_ENV ?? "development"),
        release: input.release ?? resolveErrorAuthorityRelease(),
        correlationId: input.requestId ?? getCorrelationContext()?.correlationId,
        rawTenantKey: input.rawTenantKey ?? getTenantKeyFromContext(),
      },
      this.refSecret,
    );
    const result = await this.safeRecord(event);
    this.enqueueNewP0P1IssueAlert(result, event);
  }

  async captureWithStore(input: ErrorCaptureInput, store: ErrorEventStore): Promise<void> {
    const event = normalizeErrorEvent(input, this.refSecret);
    try {
      await store.record(event);
    } catch (error: unknown) {
      this.logger.error("Error authority custom store failed open.", {
        runtime: event.runtime,
        service: event.service,
        fingerprint: event.fingerprint,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async safeRecord(event: NormalizedErrorEvent): Promise<ErrorRecordResult | void> {
    try {
      return await this.store.record(event);
    } catch (error: unknown) {
      this.logger.error("Error authority capture boundary failed open.", {
        runtime: event.runtime,
        service: event.service,
        fingerprint: event.fingerprint,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private enqueueNewP0P1IssueAlert(result: ErrorRecordResult | void, event: NormalizedErrorEvent): void {
    if (!result?.stored || !result.created || !result.issueId || !this.internalOpsAlertsService) {
      return;
    }
    if (result.severity !== "p0" && result.severity !== "p1") {
      return;
    }
    void this.internalOpsAlertsService
      .captureNewP0P1Issue({
        issueId: result.issueId,
        severity: result.severity,
        observedAt: event.occurredAt,
      })
      .catch((error: unknown) => {
        this.logger.warn("Internal ops Error Authority alert failed open.", {
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      });
  }
}
