import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from "@nestjs/common";
import type { Request, Response } from "express";
import { Observable, tap } from "rxjs";
import { AuditService } from "../../audit/audit.service";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function sanitizePath(url?: string) {
  const rawPath = (url ?? "").split("?")[0] ?? "";
  if (!rawPath) {
    return "unknown";
  }
  return rawPath;
}

function extractResourceId(params: unknown, responseBody: unknown): string | null {
  if (params && typeof params === "object") {
    const id = (params as Record<string, unknown>).id;
    if (typeof id === "string" && id.length > 0) {
      return id;
    }
    const rowId = (params as Record<string, unknown>).rowId;
    if (typeof rowId === "string" && rowId.length > 0) {
      return rowId;
    }
  }

  if (responseBody && typeof responseBody === "object" && !Array.isArray(responseBody)) {
    const id = (responseBody as Record<string, unknown>).id;
    if (typeof id === "string" && id.length > 0) {
      return id;
    }
  }
  return null;
}

@Injectable()
export class AuditLogInterceptor implements NestInterceptor {
  constructor(private readonly auditService: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request & { pimRole?: string; pimUserId?: string }>();
    const response = context.switchToHttp().getResponse<Response>();
    const method = (request.method ?? "GET").toUpperCase();
    if (READ_METHODS.has(method)) {
      return next.handle();
    }

    const actorId = typeof request.pimUserId === "string" && request.pimUserId.trim().length > 0
      ? request.pimUserId.trim()
      : "system";
    const actorRole = typeof request.pimRole === "string" && request.pimRole.trim().length > 0
      ? request.pimRole
      : "system";
    const resource = sanitizePath(request.url);

    return next.handle().pipe(
      tap((responseBody) => {
        const metadata = {
          method,
          path: resource,
          statusCode: response.statusCode,
        };
        void this.auditService.record({
          actorId,
          actorRole,
          action: method,
          resource,
          resourceId: extractResourceId(request.params, responseBody),
          metadata,
        });
      }),
    );
  }
}
