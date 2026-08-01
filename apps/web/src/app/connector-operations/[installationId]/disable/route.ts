import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl } from "@/lib/api-base-url";
import { resolveBearerToken, validateFormCsrf, validateOrigin } from "../../../api/_auth";

interface RouteContext {
  params: Promise<{
    installationId: string;
  }>;
}

// Loose sanity check only — the API's own parameterized lookup is the
// authoritative validation. This just rejects obviously malformed input
// before making a network call.
const INSTALLATION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Native-form (URL-action) POST endpoint for disabling a connector
 * installation. Deliberately NOT a Server Action: it's a plain HTML form
 * (<form method="post" action="...">), so the mutation and its outcome
 * don't depend on React's Action/Transition machinery or on hydration
 * completing — see HANDOFF_PRODUCTION_BUILD_20260730.md / the PR416
 * hydration-race investigation for why that matters here.
 *
 * Pre-flight checks (Origin, CSRF, auth, installationId shape) fail with a
 * direct HTTP error — no mutation attempted, nothing to redirect to.
 * Post-flight: on API success, redirect (303) to the result page, which
 * re-queries the API for the authoritative state rather than trusting a URL
 * param. On API failure (permission/not-found/etc.), return that status
 * directly rather than redirecting — the operation didn't happen, so there's
 * no "go see the result" to send the browser to.
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

  const apiResponse = await fetch(`${getApiBaseUrl()}/connectors/${encodeURIComponent(installationId)}/uninstall`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });

  if (!apiResponse.ok) {
    // Surface the API's status directly; don't leak its body (may contain
    // stack-adjacent detail) — the result page never sees this either way,
    // since we don't redirect on failure.
    return NextResponse.json(
      { error: "DISABLE_REQUEST_FAILED" },
      { status: apiResponse.status === 401 || apiResponse.status === 403 || apiResponse.status === 404 ? apiResponse.status : 502 },
    );
  }

  return new NextResponse(null, {
    status: 303,
    headers: {
      Location: `/connector-operation-results/disable/${encodeURIComponent(installationId)}`,
      "Cache-Control": "no-store",
    },
  });
}
