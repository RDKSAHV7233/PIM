import { timingSafeEqual } from "node:crypto";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const PROOF_ERROR = new Error("ERR_04B_NEXT_SERVER_ACTION_RUNTIME_PROOF");
PROOF_ERROR.name = "Err04bNextServerActionRuntimeProof";
Object.defineProperty(PROOF_ERROR, "code", {
  value: "ERR_04B_NEXT_SERVER_ACTION_RUNTIME_PROOF",
  enumerable: false,
});

async function triggerServerActionRuntimeProof(formData: FormData) {
  "use server";

  if (!isRuntimeProofAvailable()) {
    notFound();
  }

  const expectedToken = String(process.env.ERROR_AUTHORITY_RUNTIME_PROOF_TOKEN ?? "").trim();
  const submittedToken = String(formData.get("proofToken") ?? "").trim();
  if (!safeEquals(submittedToken, expectedToken)) {
    notFound();
  }

  throw PROOF_ERROR;
}

export default function ErrorAuthorityServerActionRuntimeProofPage() {
  if (!isRuntimeProofAvailable()) {
    notFound();
  }

  return (
    <main>
      <form action={triggerServerActionRuntimeProof}>
        <label htmlFor="proofToken">Runtime proof token</label>
        <input id="proofToken" name="proofToken" type="password" autoComplete="off" />
        <button type="submit">Trigger server action proof</button>
      </form>
    </main>
  );
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
