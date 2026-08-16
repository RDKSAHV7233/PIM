import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl } from "@/lib/api-base-url";
import { resolveBearerToken, validateFormCsrf, validateOrigin } from "../../../api/_auth";

interface RouteContext {
  params: Promise<{
    installationId: string;
  }>;
}

const INSTALLATION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
const STEP_UP_SCOPE_CONNECTOR_CREDENTIALS_HIGH_RISK = "connector_credentials_high_risk";
const STEP_UP_TOKEN_HEADER = "x-pim-step-up-token";
// Comfortably longer than the backend's own internal per-connector HTTP
// timeout (WooCommerce's callApi uses 30s) — this route calling the PATCH
// with a SHORTER timeout than the backend's own outbound check could abort
// the request while the backend is still genuinely working, turning a slow
// but real verification into an unhandled failure here.
const STEP_UP_TIMEOUT_MS = 20_000;
const CREDENTIALS_TIMEOUT_MS = 45_000;

/**
 * Native-form (URL-action) POST endpoint for replacing a connector
 * installation's stored credentials. Deliberately NOT a Server Action —
 * same reasoning as the sibling reconnect/route.ts: a Server Action's
 * redirect() performs a client-side navigation that silently drops query
 * params on this app (matches vercel/next.js#71311), so an outcome banner
 * built that way never rendered no matter how the redirect URL was built.
 * This was live-verified as a real regression here too (not just assumed
 * from the reconnect precedent) — the original Server Action version of
 * this exact flow left the page showing no banner and no status change,
 * even though the backend request itself completed (a genuine 303 was
 * observed in the network log).
 *
 * Also uses a relative Location header, not `new URL(path, request.url)` —
 * behind this deployment's reverse proxy, request.url reports the internal
 * listener origin, not the public one.
 *
 * Candidate credential values pass straight through the form body to the
 * PATCH call below and are never logged, echoed into a response, or
 * inspected beyond forwarding — matches the "ephemeral plaintext" invariant
 * the backend candidate-verification methods also hold to.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const originError = validateOrigin(request);
  if (originError) {
    return originError;
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "INVALID_FORM_BODY" }, { status: 400 });
  }

  const csrfError = validateFormCsrf(request, String(formData.get("csrfToken") ?? ""));
  if (csrfError) {
    return csrfError;
  }

  const authHeader = resolveBearerToken(request);
  if (!authHeader) {
    return NextResponse.json({ error: "MISSING_AUTH_TOKEN" }, { status: 401 });
  }

  const { installationId } = await context.params;
  if (!INSTALLATION_ID_PATTERN.test(installationId)) {
    return NextResponse.json({ error: "INVALID_INSTALLATION_ID" }, { status: 400 });
  }

  const returnTo = String(formData.get("returnTo") ?? "").trim() || `/channels/connectors/${encodeURIComponent(installationId)}?tab=credentials`;
  const redirectUrl = new URL(returnTo, "http://placeholder.invalid");
  const params = redirectUrl.searchParams;
  const redirectPath = redirectUrl.pathname;

  const redirect = (extra: Record<string, string>) => {
    for (const [key, value] of Object.entries(extra)) {
      params.set(key, value);
    }
    return new NextResponse(null, {
      status: 303,
      headers: { Location: `${redirectPath}?${params.toString()}`, "Cache-Control": "no-store" },
    });
  };

  const password = String(formData.get("stepUpPassword") ?? "").trim();
  if (!password) {
    return redirect({ stepUpError: "STEP_UP_PASSWORD_REQUIRED" });
  }

  let stepUpResponse: Response;
  try {
    stepUpResponse = await fetch(`${getApiBaseUrl()}/auth/step-up`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password, scope: STEP_UP_SCOPE_CONNECTOR_CREDENTIALS_HIGH_RISK }),
      cache: "no-store",
      signal: AbortSignal.timeout(STEP_UP_TIMEOUT_MS),
    });
  } catch {
    return redirect({ stepUpError: "STEP_UP_REQUIRED" });
  }

  if (!stepUpResponse.ok) {
    let errorCode = stepUpResponse.status === 401 ? "STEP_UP_INVALID_CREDENTIALS" : "STEP_UP_REQUIRED";
    try {
      const body = (await stepUpResponse.json()) as { error?: string };
      if (body && typeof body.error === "string" && body.error.trim()) {
        errorCode = body.error.trim();
      }
    } catch {
      // Non-JSON or empty error body — keep the status-derived fallback code.
    }
    return redirect({ stepUpError: errorCode });
  }

  const stepUpBody = (await stepUpResponse.json()) as { stepUpToken?: string };
  const stepUpToken = String(stepUpBody.stepUpToken ?? "").trim();

  const externalAccountRef = String(formData.get("externalAccountRef") ?? "").trim();
  const clientId = String(formData.get("clientId") ?? "").trim();
  const clientSecret = String(formData.get("clientSecret") ?? "").trim();
  const refreshToken = String(formData.get("refreshToken") ?? "").trim();

  let apiResponse: Response;
  try {
    apiResponse = await fetch(`${getApiBaseUrl()}/connectors/${encodeURIComponent(installationId)}/credentials`, {
      method: "PATCH",
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
        "Content-Type": "application/json",
        [STEP_UP_TOKEN_HEADER]: stepUpToken,
      },
      body: JSON.stringify({
        externalAccountRef: externalAccountRef || undefined,
        clientId: clientId || undefined,
        clientSecret: clientSecret || undefined,
        refreshToken: refreshToken || undefined,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(CREDENTIALS_TIMEOUT_MS),
    });
  } catch {
    // Timeout, connection reset, DNS failure, etc. — the credential check
    // itself may still be running server-side, but we can't wait forever on
    // this request. No positive evidence either way, so this is "unavailable"
    // (not "invalid") — existing credentials are untouched either way.
    return redirect({ status: "credentials-unavailable", reasonMessage: "The request timed out before Vexa could confirm the result. Existing credentials were not changed — try again shortly." });
  }

  if (!apiResponse.ok) {
    let reasonMessage = "";
    try {
      const body = (await apiResponse.json()) as { message?: string };
      if (body && typeof body.message === "string" && body.message.trim()) {
        reasonMessage = body.message.trim();
      }
    } catch {
      // Non-JSON or empty error body — keep the generic fallback message.
    }
    return redirect({
      status: apiResponse.status === 503 ? "credentials-unavailable" : "credentials-invalid",
      ...(reasonMessage ? { reasonMessage } : {}),
    });
  }

  const resultBody = (await apiResponse.json()) as { verification?: { outcome?: string } };
  return redirect({
    status: resultBody.verification?.outcome === "not_supported" ? "credentials-saved-verification-unavailable" : "credentials-updated",
  });
}
