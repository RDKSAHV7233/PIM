import { ArgumentsHost, BadRequestException, Catch, HttpException, HttpStatus, Optional } from "@nestjs/common";
import { BaseExceptionFilter, HttpAdapterHost } from "@nestjs/core";
import type { Request } from "express";
import { LoggerService } from "../common/logging/logger.service";
import { VALIDATION_FAILED_CODE } from "../common/validation-exception.factory";
import { ErrorCaptureService } from "./error-capture.service";

const CAPTURED_MARKER = Symbol("vexa.errorAuthorityCaptured");
const EXPECTED_HTTP_STATUSES = new Set<number>([
  HttpStatus.BAD_REQUEST,
  HttpStatus.UNAUTHORIZED,
  HttpStatus.FORBIDDEN,
  HttpStatus.NOT_FOUND,
  HttpStatus.CONFLICT,
  HttpStatus.UNPROCESSABLE_ENTITY,
  HttpStatus.TOO_MANY_REQUESTS,
]);

type RequestWithActor = Request & {
  pimUserId?: string;
  pimAuthType?: "user_jwt" | "api_key";
};

type CapturableException = Error & {
  [CAPTURED_MARKER]?: boolean;
};

@Catch()
export class ApiExceptionCaptureFilter extends BaseExceptionFilter {
  constructor(
    private readonly errorCaptureService: ErrorCaptureService,
    adapterHost: HttpAdapterHost,
    @Optional() private readonly logger?: LoggerService,
  ) {
    super(adapterHost.httpAdapter);
  }

  catch(exception: unknown, host: ArgumentsHost) {
    // A NUL (U+0000) that reaches Postgres (multipart files, CSV cells, any path the early
    // request scan cannot see) is a client error, not a server fault (prod-cert DEF-PC-010).
    if (host.getType() === "http" && isNulByteDatabaseError(exception)) {
      exception = new BadRequestException({
        error: VALIDATION_FAILED_CODE,
        message: "Input contains a NUL (U+0000) character, which is not allowed.",
        fields: [],
      });
    }
    if (host.getType() === "http" && shouldCaptureApiException(exception)) {
      if (!isCaptured(exception)) {
        markCaptured(exception);
        const request = host.switchToHttp().getRequest<RequestWithActor>();
        void this.errorCaptureService
          .captureUnexpected({
            runtime: "api",
            service: "vexa-pim-api",
            error: exception,
            errorCode: extractErrorCode(exception),
            category: "internal",
            severity: "p1",
            routeTemplate: resolveRouteTemplate(request),
            method: request.method,
            statusCode: resolveStatusCode(exception),
            rawActorId: request.pimUserId,
            actorType: request.pimAuthType === "api_key" ? "api_client" : request.pimUserId ? "human" : "anonymous",
          })
          .catch((captureErr: unknown) => {
            this.logger?.warn("Error Authority capture boundary failed open in global filter.", {
              captureError: captureErr instanceof Error ? captureErr.message : String(captureErr),
            });
          });
      }
    }
    super.catch(exception, host);
  }
}

/**
 * Postgres rejects U+0000 in text with SQLSTATE 22021 ("invalid byte sequence for encoding
 * UTF8: 0x00"). Prisma surfaces it as PrismaClientKnownRequestError P2010 (raw queries, with
 * meta.code 22021) or PrismaClientUnknownRequestError (model operations, message text only).
 */
export function isNulByteDatabaseError(exception: unknown): boolean {
  if (!(exception instanceof Error)) {
    return false;
  }
  const meta = (exception as { meta?: { code?: unknown; message?: unknown } }).meta;
  const text = `${exception.message} ${typeof meta?.message === "string" ? meta.message : ""}`.toLowerCase();
  return text.includes("invalid byte sequence for encoding") && text.includes("0x00");
}

function isCaptured(exception: unknown): boolean {
  if (!exception || (typeof exception !== "object" && typeof exception !== "function")) {
    return false;
  }
  return Boolean((exception as CapturableException)[CAPTURED_MARKER]);
}

function markCaptured(exception: unknown): void {
  if (!exception || (typeof exception !== "object" && typeof exception !== "function")) {
    return;
  }
  (exception as CapturableException)[CAPTURED_MARKER] = true;
}

export function shouldCaptureApiException(exception: unknown): boolean {
  if (!(exception instanceof HttpException)) {
    return true;
  }
  const status = exception.getStatus();
  if (EXPECTED_HTTP_STATUSES.has(status)) {
    return false;
  }
  return status >= 500;
}

export function resolveStatusCode(exception: unknown): number {
  if (exception instanceof HttpException) {
    return exception.getStatus();
  }
  return HttpStatus.INTERNAL_SERVER_ERROR;
}

export function extractErrorCode(exception: unknown): string | undefined {
  if (!(exception instanceof HttpException)) {
    return exception instanceof Error ? exception.name : undefined;
  }
  const response = exception.getResponse();
  if (typeof response === "string") {
    return undefined;
  }
  if (response && typeof response === "object") {
    const candidate = (response as { code?: unknown; error?: unknown }).code ?? (response as { error?: unknown }).error;
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate.trim().slice(0, 120);
    }
  }
  return undefined;
}

export function resolveRouteTemplate(request: Request | undefined): string | undefined {
  if (!request) {
    return undefined;
  }
  const routePath = request.route && typeof request.route.path === "string" ? request.route.path : "";
  const baseUrl = typeof request.baseUrl === "string" ? request.baseUrl : "";
  const routeTemplate = `${baseUrl}${routePath}`.trim();
  if (routeTemplate) {
    return routeTemplate.slice(0, 240);
  }
  const rawUrl = String(request.originalUrl ?? request.url ?? "").trim();
  if (!rawUrl) {
    return undefined;
  }
  return rawUrl.split("?")[0]?.split("#")[0]?.slice(0, 240);
}
