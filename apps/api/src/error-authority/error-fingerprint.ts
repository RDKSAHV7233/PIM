import { createHash } from "node:crypto";
import type { ErrorCaptureInput, NormalizedErrorEvent } from "./error-authority.types";
import { createSafeRef, normalizeErrorMessage, normalizeFrames, toSafeText } from "./error-redaction";

export const ERROR_FINGERPRINT_VERSION = 1;

export function normalizeErrorEvent(input: ErrorCaptureInput, refSecret: string | undefined): NormalizedErrorEvent {
  const normalizedFrames = normalizeFrames(input.frames);
  const topFrame = normalizedFrames?.[0];
  const normalizedMessage = normalizeErrorMessage(input.error);
  const errorName = input.error instanceof Error ? input.error.name : "Error";
  const fingerprintBasis = [
    input.runtime,
    input.service,
    input.environment,
    String(input.errorCode ?? errorName),
    String(input.routeTemplate ?? "unknown-route"),
    String(topFrame?.file ?? "unknown-file"),
    String(topFrame?.functionName ?? "unknown-function"),
    normalizedMessage,
  ].join("|");
  const fingerprint = sha256(fingerprintBasis);
  const stackHash = normalizedFrames ? sha256(JSON.stringify(normalizedFrames)) : undefined;
  const safeMessage = toSafeText(input.error);
  return {
    fingerprint,
    fingerprintVersion: ERROR_FINGERPRINT_VERSION,
    runtime: input.runtime,
    service: input.service,
    environment: input.environment,
    release: input.release,
    errorCode: input.errorCode,
    category: input.category ?? "unknown",
    severity: input.severity ?? "p2",
    safeTitle: buildSafeTitle(input.errorCode, errorName, safeMessage),
    safeMessage,
    normalizedMessage,
    occurredAt: input.occurredAt ?? new Date(),
    requestId: input.requestId,
    correlationId: input.correlationId,
    routeTemplate: input.routeTemplate,
    method: input.method,
    statusCode: input.statusCode,
    safeTenantRef: createSafeRef("tenant", input.rawTenantKey, refSecret),
    safeActorRef: createSafeRef("actor", input.rawActorId, refSecret),
    actorType: input.actorType,
    jobId: input.jobId,
    operationId: input.operationId,
    installationId: input.installationId,
    topFrameFile: topFrame?.file,
    topFrameFunction: topFrame?.functionName,
    topFrameLine: topFrame?.line,
    normalizedFrames,
    stackHash,
    sourceEventId: input.sourceEventId,
  };
}

function buildSafeTitle(errorCode: string | undefined, errorName: string, safeMessage: string): string {
  const prefix = String(errorCode ?? errorName ?? "Error").trim() || "Error";
  const message = safeMessage.length > 0 ? safeMessage : "Unexpected application error";
  return `${prefix}: ${message}`.slice(0, 180);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
