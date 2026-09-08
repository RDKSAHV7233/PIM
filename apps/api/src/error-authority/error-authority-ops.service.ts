import { Injectable, NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import type { ListErrorIssuesDto } from "./dto/list-error-issues.dto";
import type { ListErrorOccurrencesDto } from "./dto/list-error-occurrences.dto";
import { ObservabilityDbService } from "./observability-db.service";

export type ErrorAuthorityIssueListItem = {
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
  firstSeenAt: string;
  lastSeenAt: string;
  firstSeenRelease: string | null;
  lastSeenRelease: string | null;
  occurrenceCount: number;
  affectedTenantCount: number;
  latestOccurrenceId: string | null;
};

export type ErrorAuthorityOccurrenceListItem = {
  id: string;
  issueId: string;
  occurredAt: string;
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

export type ErrorAuthorityListResponse<T> = {
  items: T[];
  limit: number;
  nextCursor: string | null;
  storageAvailable: boolean;
  window: {
    dateFrom: string;
    dateTo: string;
  };
};

type CursorPayload = {
  at: string;
  id: string;
};

const DEFAULT_WINDOW_DAYS = 7;
const MAX_WINDOW_DAYS = 31;
const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 50;

/** Shape resolveIssue() returns to the controller: response fields plus the
 *  audit metadata (fingerprint/service/runtime/severity/previousState) the
 *  controller needs for its explicit ERROR_ISSUE_RESOLVED audit call. */
export type ResolveErrorIssueResult = {
  id: string;
  state: string;
  previousState: string;
  fingerprint: string;
  service: string;
  runtime: string;
  severity: string;
};

@Injectable()
export class ErrorAuthorityOpsService {
  constructor(private readonly observabilityDb: ObservabilityDbService) {}

  async listIssues(query: ListErrorIssuesDto): Promise<ErrorAuthorityListResponse<ErrorAuthorityIssueListItem>> {
    const limit = parseLimit(query.limit);
    const window = resolveDateWindow(query.dateFrom, query.dateTo);
    return this.observabilityDb.listErrorIssues({
      runtime: clean(query.runtime),
      service: clean(query.service),
      severity: clean(query.severity),
      state: clean(query.state),
      release: clean(query.release),
      errorCode: clean(query.errorCode),
      route: cleanRoute(query.route),
      dateFrom: window.dateFrom,
      dateTo: window.dateTo,
      cursor: decodeCursor(query.cursor),
      limit,
      encodeCursor,
    });
  }

  async listOccurrences(
    issueId: string,
    query: ListErrorOccurrencesDto,
  ): Promise<ErrorAuthorityListResponse<ErrorAuthorityOccurrenceListItem>> {
    const limit = parseLimit(query.limit);
    const window = resolveDateWindow(query.dateFrom, query.dateTo);
    return this.observabilityDb.listErrorOccurrences({
      issueId,
      dateFrom: window.dateFrom,
      dateTo: window.dateTo,
      cursor: decodeCursor(query.cursor),
      limit,
      encodeCursor,
    });
  }

  /**
   * PIM#766 Part 1: manual resolve. Idempotent — resolving an already-
   * "resolved" issue succeeds (200) rather than erroring, so a double-click
   * or a retried request from the UI is harmless.
   */
  async resolveIssue(issueId: string): Promise<ResolveErrorIssueResult> {
    const result = await this.observabilityDb.resolveIssue(issueId);
    if (result.outcome === "not_found") {
      throw new NotFoundException({ error: "ERROR_ISSUE_NOT_FOUND", resourceId: issueId });
    }
    if (result.outcome === "storage_unavailable") {
      throw new ServiceUnavailableException({ error: "ERROR_AUTHORITY_STORAGE_UNAVAILABLE" });
    }
    const { issue } = result;
    return {
      id: issue.id,
      state: issue.state,
      previousState: result.outcome === "resolved" ? result.previousState : issue.state,
      fingerprint: issue.fingerprint,
      service: issue.service,
      runtime: issue.runtime,
      severity: issue.severity,
    };
  }
}

function clean(value: unknown): string | undefined {
  const text = String(value ?? "").trim();
  return text.length > 0 ? text : undefined;
}

function cleanRoute(value: unknown): string | undefined {
  const text = clean(value);
  if (!text) {
    return undefined;
  }
  return text.split("?")[0]?.split("#")[0]?.slice(0, 240) || undefined;
}

function parseLimit(value: unknown): number {
  const parsed = Number(value ?? DEFAULT_LIMIT);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_LIMIT;
  }
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(parsed)));
}

function resolveDateWindow(dateFromInput: unknown, dateToInput: unknown): { dateFrom: Date; dateTo: Date } {
  const now = new Date();
  const requestedTo = parseDate(dateToInput) ?? now;
  const latestTo = requestedTo.getTime() > now.getTime() ? now : requestedTo;
  const requestedFrom = parseDate(dateFromInput);
  const defaultFrom = new Date(latestTo.getTime() - DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const earliestAllowedFrom = new Date(latestTo.getTime() - MAX_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const rawFrom = requestedFrom ?? defaultFrom;
  const boundedFrom = rawFrom.getTime() < earliestAllowedFrom.getTime() ? earliestAllowedFrom : rawFrom;
  return {
    dateFrom: boundedFrom,
    dateTo: latestTo,
  };
}

function parseDate(value: unknown): Date | null {
  const text = String(value ?? "").trim();
  if (!text) {
    return null;
  }
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date : null;
}

function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeCursor(value: unknown): CursorPayload | undefined {
  const text = String(value ?? "").trim();
  if (!text) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(Buffer.from(text, "base64url").toString("utf8")) as Partial<CursorPayload>;
    const at = String(parsed.at ?? "").trim();
    const id = String(parsed.id ?? "").trim();
    if (!at || !id || !Number.isFinite(new Date(at).getTime())) {
      return undefined;
    }
    return { at, id };
  } catch {
    return undefined;
  }
}
