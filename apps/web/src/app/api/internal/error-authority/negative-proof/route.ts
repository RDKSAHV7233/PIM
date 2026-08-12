import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getApiBaseUrl } from "@/lib/api-base-url";
import { captureNextServerError } from "@/lib/server/next-server-error-capture";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const FAIL_OPEN_PROOF_ERROR = new Error("ERR_04B_NEXT_SERVER_FAIL_OPEN_RUNTIME_PROOF");
FAIL_OPEN_PROOF_ERROR.name = "Err04bNextServerFailOpenRuntimeProof";
Object.defineProperty(FAIL_OPEN_PROOF_ERROR, "code", {
  value: "ERR_04B_NEXT_SERVER_FAIL_OPEN_RUNTIME_PROOF",
  enumerable: false,
});

export async function POST(request: Request) {
  if (!isRuntimeProofAvailable()) {
    return notFoundResponse();
  }

  const expectedToken = String(process.env.ERROR_AUTHORITY_RUNTIME_PROOF_TOKEN ?? "").trim();
  const submittedToken = String(request.headers.get("x-error-authority-runtime-proof-token") ?? "").trim();
  if (!safeEquals(submittedToken, expectedToken)) {
    return notFoundResponse();
  }

  const authStatuses = await verifyTrustedIngestRejectsMissingOrInvalidToken();
  const failOpenOk = await verifyCaptureTransportFailureDoesNotThrow();

  return NextResponse.json({
    ingestNoTokenStatus: authStatuses.noToken,
    ingestWrongTokenStatus: authStatuses.wrongToken,
    failOpenOk,
  });
}

async function verifyTrustedIngestRejectsMissingOrInvalidToken() {
  const url = `${getApiBaseUrl()}/error-authority/ingest/next-server`;
  const body = JSON.stringify({
    sourceEventId: "negative-proof-should-not-store",
    release: process.env.ERROR_AUTHORITY_RELEASE,
    routeTemplate: "/internal/error-authority/negative-proof",
    method: "POST",
    statusCode: 500,
    errorName: "NegativeProofShouldNotStore",
    errorCode: "NEGATIVE_PROOF_SHOULD_NOT_STORE",
    category: "internal",
    severity: "p1",
    occurredAt: new Date().toISOString(),
  });

  const noToken = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: { "content-type": "application/json" },
    body,
  });
  const wrongToken = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: {
      "content-type": "application/json",
      "x-error-authority-ingest-token": "wrong",
    },
    body,
  });

  return {
    noToken: noToken.status,
    wrongToken: wrongToken.status,
  };
}

async function verifyCaptureTransportFailureDoesNotThrow(): Promise<boolean> {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error("ERR_04B_NEGATIVE_PROOF_TRANSPORT_DOWN");
  };
  try {
    await captureNextServerError(
      FAIL_OPEN_PROOF_ERROR,
      { method: "POST", url: "/internal/error-authority/negative-proof" },
      { routePath: "/internal/error-authority/negative-proof", routeType: "route" },
    );
    return true;
  } catch {
    return false;
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function isRuntimeProofAvailable(): boolean {
  const appEnv = String(process.env.APP_ENV ?? process.env.NODE_ENV ?? "").trim().toLowerCase();
  if (appEnv !== "staging") {
    return false;
  }
  if (String(process.env.ERROR_AUTHORITY_ENABLED ?? "").trim().toLowerCase() !== "true") {
    return false;
  }
  return Boolean(String(process.env.ERROR_AUTHORITY_RUNTIME_PROOF_TOKEN ?? "").trim());
}

function safeEquals(submitted: string, expected: string): boolean {
  if (!submitted || !expected) {
    return false;
  }
  const submittedBuffer = Buffer.from(submitted);
  const expectedBuffer = Buffer.from(expected);
  return submittedBuffer.length === expectedBuffer.length && timingSafeEqual(submittedBuffer, expectedBuffer);
}

function notFoundResponse() {
  return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
}
