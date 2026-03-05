import { Injectable } from "@nestjs/common";
import { getTenantKeyFromContext } from "../tenant/tenant-context";
import { getCorrelationContext } from "./correlation-context";

type LogLevel = "info" | "warn" | "error";

interface LogPayload {
  timestamp: string;
  level: LogLevel;
  message: string;
  correlationId: string;
  tenantId: string;
  meta?: Record<string, unknown>;
}

function safeMeta(meta?: Record<string, unknown>): Record<string, unknown> | undefined {
  if (!meta) {
    return undefined;
  }
  const entries = Object.entries(meta).filter(([, value]) => value !== undefined);
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

@Injectable()
export class LoggerService {
  info(message: string, meta?: Record<string, unknown>) {
    this.emit("info", message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>) {
    this.emit("warn", message, meta);
  }

  error(message: string, meta?: Record<string, unknown>) {
    this.emit("error", message, meta);
  }

  private emit(level: LogLevel, message: string, meta?: Record<string, unknown>) {
    const payload: LogPayload = {
      timestamp: new Date().toISOString(),
      level,
      message,
      correlationId: getCorrelationContext()?.correlationId ?? "none",
      tenantId: getTenantKeyFromContext(),
      meta: safeMeta(meta),
    };
    const line = JSON.stringify(payload);
    if (level === "warn" || level === "error") {
      // stderr sink for warning/error severity lines.
      // eslint-disable-next-line no-console
      console.error(line);
      return;
    }
    // eslint-disable-next-line no-console
    console.log(line);
  }
}
