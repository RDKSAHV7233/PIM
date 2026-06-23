import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl } from "@/lib/api-base-url";
import { resolveBearerToken, validateCsrf } from "../_auth";

export async function DELETE(request: NextRequest) {
  const csrfError = validateCsrf(request);
  if (csrfError) {
    return csrfError;
  }
  const body = await request.json();
  const authHeader = resolveBearerToken(request);
  if (!authHeader) {
    return NextResponse.json(
      {
        error: "MISSING_AUTH_TOKEN",
      },
      { status: 401 },
    );
  }

  const response = await fetch(`${getApiBaseUrl()}/auth/account`, {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });

  const contentType = response.headers.get("content-type") ?? "application/json";
  const payload = await response.text();
  return new NextResponse(payload, {
    status: response.status,
    headers: {
      "Content-Type": contentType,
    },
  });
}
