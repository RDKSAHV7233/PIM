import { timingSafeEqual } from "node:crypto";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PROOF_ERROR = new Error("ERR_04B_NEXT_SERVER_RENDER_RUNTIME_PROOF");
PROOF_ERROR.name = "Err04bNextServerRenderRuntimeProof";
Object.defineProperty(PROOF_ERROR, "code", {
  value: "ERR_04B_NEXT_SERVER_RENDER_RUNTIME_PROOF",
  enumerable: false,
});

export default async function ErrorAuthorityRuntimeProofPage() {
  if (!isRuntimeProofAvailable()) {
    notFound();
  }

  const requestHeaders = await headers();
  const expectedToken = String(process.env.ERROR_AUTHORITY_RUNTIME_PROOF_TOKEN ?? "").trim();
  const submittedToken = String(requestHeaders.get("x-error-authority-runtime-proof-token") ?? "").trim();
  if (!safeEquals(submittedToken, expectedToken)) {
    notFound();
  }

  throw PROOF_ERROR;
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
