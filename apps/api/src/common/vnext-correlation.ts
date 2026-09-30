import { randomUUID } from "node:crypto";

const VNEXT_CORRELATION_PREFIX = "vnext";

export function createVnextCorrelationId(): string {
  // ADR-0011's shared ConnectorContext.correlationId migration is accepted but
  // not implemented yet; keep this local and swappable for the controlled
  // mutation path until that cross-connector contract lands.
  return `${VNEXT_CORRELATION_PREFIX}_${randomUUID()}`;
}
