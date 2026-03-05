import { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { runWithCorrelationContext } from "./correlation-context";

const CORRELATION_HEADER = "x-correlation-id";

function resolveCorrelationId(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    const first = value[0]?.trim();
    if (first) {
      return first;
    }
  }
  if (typeof value === "string" && value.trim().length > 0) {
    return value.trim();
  }
  return randomUUID();
}

export function correlationMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void,
) {
  const correlationId = resolveCorrelationId(req.headers[CORRELATION_HEADER]);
  res.setHeader(CORRELATION_HEADER, correlationId);
  runWithCorrelationContext({ correlationId }, next);
}
