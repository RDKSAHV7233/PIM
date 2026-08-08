import { Injectable } from "@nestjs/common";
import { resolveErrorAuthorityRelease } from "../common/error-authority-env";
import { getCorrelationContext } from "../common/logging/correlation-context";
import { LoggerService } from "../common/logging/logger.service";
import { getTenantKeyFromContext } from "../common/tenant/tenant-context";
import type { ErrorCaptureInput, ErrorEventStore, NormalizedErrorEvent } from "./error-authority.types";
import { normalizeErrorEvent } from "./error-fingerprint";
import { ObservabilityDbService } from "./observability-db.service";

@Injectable()
export class ErrorCaptureService {
  private readonly refSecret = String(process.env.ERROR_AUTHORITY_REF_SECRET ?? "").trim();

  constructor(
    private readonly store: ObservabilityDbService,
    private readonly logger: LoggerService,
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
    await this.safeRecord(event);
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

  private async safeRecord(event: NormalizedErrorEvent): Promise<void> {
    try {
      await this.store.record(event);
    } catch (error: unknown) {
      this.logger.error("Error authority capture boundary failed open.", {
        runtime: event.runtime,
        service: event.service,
        fingerprint: event.fingerprint,
        errorMessage: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
