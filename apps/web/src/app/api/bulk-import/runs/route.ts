import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl } from "@/lib/api-base-url";
import { resolveBearerToken, validateCsrf } from "../../_auth";

export async function POST(request: NextRequest) {
  const csrfError = validateCsrf(request);
  if (csrfError) {
    return csrfError;
  }

  const authHeader = resolveBearerToken(request);
  if (!authHeader) {
    return NextResponse.json({ error: "MISSING_AUTH_TOKEN" }, { status: 401 });
  }

  const body = await request.text();
  const response = await fetch(`${getApiBaseUrl()}/bulk-import/runs`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      Accept: "application/json",
      "Content-Type": request.headers.get("content-type") ?? "application/json",
    },
    body,
    cache: "no-store",
  });

  const payload = await response.text();
  return new NextResponse(payload, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("content-type") ?? "application/json; charset=utf-8",
    },
  });
}
