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
 * Native-form (URL-action) POST endpoint for reconnecting a connector
 * installation. Deliberately NOT a Server Action — see the sibling
 * disable/route.ts for the original reasoning (hydration-race safety), and
 * #564 for a second, independent reason this matters for reconnect
 * specifically: a Server Action's redirect() interacts badly with this app's
 * global middleware (matches vercel/next.js#71311 — search params attached
 * to a Server Action's redirect target reach the middleware correctly but
 * the client ends up on a page without them, so the outcome banner never
 * rendered no matter how the redirect URL was built). A native form POST to
 * a plain Route Handler does a real HTTP 303 redirect, entirely outside
 * that Server-Action-to-client-router translation, and isn't subject to it.
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

  const connectorSlug = String(formData.get("connectorSlug") ?? "").trim();

  const apiResponse = await fetch(`${getApiBaseUrl()}/connectors/${encodeURIComponent(installationId)}/reconnect`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });

  // Relative path, not new URL(path, request.url): behind this deployment's
  // reverse proxy, request.url reports the internal listener origin, not the
  // public one, so an absolute redirect built from it sends the browser to
  // an unreachable internal host. A relative Location header is resolved by
  // the browser against the current (public) origin instead — same fix as
  // the sibling disable/route.ts already relies on.
  const params = new URLSearchParams();

  if (!apiResponse.ok) {
    let errorCode = "reconnect_failed";
    try {
      const body = (await apiResponse.json()) as { error?: string };
      if (body && typeof body.error === "string" && body.error.trim()) {
        errorCode = body.error.trim();
      }
    } catch {
      // Non-JSON or empty error body — keep the generic fallback code.
    }
    params.set("reconnectError", errorCode);
    if (connectorSlug) {
      params.set("connectorSlug", connectorSlug);
    }
    return new NextResponse(null, {
      status: 303,
      headers: { Location: `/channels/connectors?${params.toString()}`, "Cache-Control": "no-store" },
    });
  }

  params.set("status", "reconnected");
  return new NextResponse(null, {
    status: 303,
    headers: { Location: `/channels/connectors?${params.toString()}`, "Cache-Control": "no-store" },
  });
}
