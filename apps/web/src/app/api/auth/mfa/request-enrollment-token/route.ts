import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl } from "@/lib/api-base-url";
import { resolveBearerToken, validateCsrf } from "../../../_auth";

export async function POST(request: NextRequest) {
  const csrfError = validateCsrf(request);
  if (csrfError) return csrfError;

  const authHeader = resolveBearerToken(request);
  if (!authHeader) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}/auth/mfa/request-enrollment-token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({}),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return NextResponse.json({ error: "AUTH_UPSTREAM_UNAVAILABLE" }, { status: 503 });
  }

  const rawBody = await response.text();
  return new NextResponse(rawBody, {
    status: response.status,
    headers: { "Content-Type": response.headers.get("content-type") ?? "application/json" },
  });
}
