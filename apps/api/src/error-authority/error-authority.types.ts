export type ErrorRuntime = "api" | "worker" | "next_server" | "browser";
export type ErrorCategory =
  | "internal"
  | "network"
  | "timeout"
  | "database"
  | "cache"
  | "authentication"
  | "authorization"
  | "contract"
  | "dependency"
  | "rendering"
  | "hydration"
  | "unknown";
export type ErrorSeverity = "p0" | "p1" | "p2" | "p3";

export interface SafeStackFrame {
  file: string;
  functionName?: string;
  line?: number;
  column?: number;
}

export interface ErrorCaptureInput {
  runtime: ErrorRuntime;
  service: string;
  environment: string;
  release?: string;
  errorCode?: string;
  category?: ErrorCategory;
  severity?: ErrorSeverity;
  routeTemplate?: string;
  method?: string;
  statusCode?: number;
  requestId?: string;
  correlationId?: string;
  rawTenantKey?: string;
  rawActorId?: string;
  actorType?: "human" | "api_client" | "system" | "anonymous";
  jobId?: string;
  operationId?: string;
  installationId?: string;
  sourceEventId?: string;
  occurredAt?: Date;
  error: unknown;
  frames?: SafeStackFrame[];
}

export interface NormalizedErrorEvent {
  fingerprint: string;
  fingerprintVersion: number;
  runtime: ErrorRuntime;
  service: string;
  environment: string;
  release?: string;
  errorCode?: string;
  category: ErrorCategory;
  severity: ErrorSeverity;
  safeTitle: string;
  safeMessage: string;
  normalizedMessage: string;
  occurredAt: Date;
  requestId?: string;
  correlationId?: string;
  routeTemplate?: string;
  method?: string;
  statusCode?: number;
  safeTenantRef?: string;
  safeActorRef?: string;
  actorType?: string;
  jobId?: string;
  operationId?: string;
  installationId?: string;
  topFrameFile?: string;
  topFrameFunction?: string;
  topFrameLine?: number;
  normalizedFrames?: SafeStackFrame[];
  stackHash?: string;
  sourceEventId?: string;
}

export interface ErrorEventStore {
  record(event: NormalizedErrorEvent): Promise<void>;
}
