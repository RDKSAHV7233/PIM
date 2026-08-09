import { BadRequestException, Body, Controller, Headers, HttpCode, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { Public } from "../auth/public.decorator";
import { requireInternalToken } from "../common/security/internal-token";
import type { ErrorCategory, ErrorSeverity, SafeStackFrame } from "./error-authority.types";
import { ErrorCaptureService } from "./error-capture.service";

type TrustedNextServerPayload = {
  sourceEventId?: unknown;
  release?: unknown;
  routeTemplate?: unknown;
  method?: unknown;
  statusCode?: unknown;
  requestId?: unknown;
  errorName?: unknown;
  errorCode?: unknown;
  category?: unknown;
  severity?: unknown;
  occurredAt?: unknown;
  frames?: unknown;
};

const VALID_CATEGORIES = new Set<ErrorCategory>([
  "internal",
  "network",
  "timeout",
  "database",
  "cache",
  "authentication",
  "authorization",
  "contract",
  "dependency",
  "rendering",
  "hydration",
  "unknown",
]);

const VALID_SEVERITIES = new Set<ErrorSeverity>(["p0", "p1", "p2", "p3"]);

@Controller("error-authority")
export class NextServerErrorIngestController {
  constructor(private readonly errorCaptureService: ErrorCaptureService) {}

  @Public()
  @Post("ingest/next-server")
  @HttpCode(202)
  async ingestNextServerError(
    @Headers("x-error-authority-ingest-token") ingestToken: string | undefined,
    @Body() body: unknown,
    @Req() request: Request,
  ) {
    await requireInternalToken({
      routeKey: "error_authority.next_server_ingest",
      expectedToken: process.env.ERROR_AUTHORITY_INGEST_TOKEN,
      submittedToken: ingestToken,
      request,
      maxInvalidAttempts: 20,
    });

    const event = normalizeTrustedNextServerPayload(body);
    const error = new Error("Unexpected Next.js server error");
    error.name = event.errorName;

    await this.errorCaptureService.captureUnexpected({
      runtime: "next_server",
      service: "vexa-pim-web",
      release: event.release,
      errorCode: event.errorCode,
      category: event.category,
      severity: event.severity,
      routeTemplate: event.routeTemplate,
      method: event.method,
      statusCode: event.statusCode,
      requestId: event.requestId,
      sourceEventId: event.sourceEventId,
      occurredAt: event.occurredAt,
      error,
      frames: event.frames,
    });

    return { accepted: true };
  }
}

export function normalizeTrustedNextServerPayload(body: unknown): {
  sourceEventId: string;
  release?: string;
  routeTemplate?: string;
  method?: string;
  statusCode: number;
  requestId?: string;
  errorName: string;
  errorCode?: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  occurredAt?: Date;
  frames?: SafeStackFrame[];
} {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new BadRequestException({ error: "ERROR_AUTHORITY_PAYLOAD_INVALID" });
  }
  const payload = body as TrustedNextServerPayload;
  const sourceEventId = safeText(payload.sourceEventId, 180);
  if (!sourceEventId) {
    throw new BadRequestException({ error: "ERROR_AUTHORITY_SOURCE_EVENT_ID_REQUIRED" });
  }

  return {
    sourceEventId,
    release: safeText(payload.release, 128),
    routeTemplate: safeRoute(payload.routeTemplate),
    method: safeMethod(payload.method),
    statusCode: safeStatusCode(payload.statusCode),
    requestId: safeText(payload.requestId, 128),
    errorName: safeIdentifier(payload.errorName, "NextServerError"),
    errorCode: safeText(payload.errorCode, 120),
    category: safeCategory(payload.category),
    severity: safeSeverity(payload.severity),
    occurredAt: safeDate(payload.occurredAt),
    frames: safeFrames(payload.frames),
  };
}

function safeText(value: unknown, maxLength: number): string | undefined {
  const text = String(value ?? "").trim();
  if (!text) {
    return undefined;
  }
  return text.replace(/[\r\n\t]+/g, " ").slice(0, maxLength);
}

function safeRoute(value: unknown): string | undefined {
  const text = safeText(value, 240);
  if (!text) {
    return undefined;
  }
  return text.split("?")[0]?.split("#")[0]?.slice(0, 240) || undefined;
}

function safeMethod(value: unknown): string | undefined {
  const method = safeText(value, 12)?.toUpperCase();
  return method && /^[A-Z]+$/.test(method) ? method : undefined;
}

function safeStatusCode(value: unknown): number {
  const status = Number(value);
  return Number.isFinite(status) && status >= 500 && status <= 599 ? Math.floor(status) : 500;
}

function safeIdentifier(value: unknown, fallback: string): string {
  const text = safeText(value, 80) ?? fallback;
  return /^[A-Za-z0-9_.:-]+$/.test(text) ? text : fallback;
}

function safeCategory(value: unknown): ErrorCategory {
  const category = safeText(value, 32) as ErrorCategory | undefined;
  return category && VALID_CATEGORIES.has(category) ? category : "internal";
}

function safeSeverity(value: unknown): ErrorSeverity {
  const severity = safeText(value, 8) as ErrorSeverity | undefined;
  return severity && VALID_SEVERITIES.has(severity) ? severity : "p1";
}

function safeDate(value: unknown): Date | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : undefined;
}

function safeFrames(value: unknown): SafeStackFrame[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const frames: SafeStackFrame[] = [];
  for (const frame of value) {
    if (!frame || typeof frame !== "object" || Array.isArray(frame)) {
      continue;
    }
    const record = frame as Record<string, unknown>;
    const file = safeRoute(record.file);
    if (!file) {
      continue;
    }
    const line = Number(record.line);
    const column = Number(record.column);
    const nextFrame: SafeStackFrame = { file };
    const functionName = safeText(record.functionName, 160);
    if (functionName) {
      nextFrame.functionName = functionName;
    }
    if (Number.isFinite(line)) {
      nextFrame.line = Math.max(0, Math.floor(line));
    }
    if (Number.isFinite(column)) {
      nextFrame.column = Math.max(0, Math.floor(column));
    }
    frames.push(nextFrame);
    if (frames.length >= 20) {
      break;
    }
  }
  return frames.length > 0 ? frames : undefined;
}
