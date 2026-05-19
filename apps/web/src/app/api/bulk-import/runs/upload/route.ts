import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl } from "@/lib/api-base-url";
import { resolveBearerToken, validateCsrf } from "../../../_auth";

export async function POST(request: NextRequest) {
  const csrfError = validateCsrf(request);
  if (csrfError) {
    return csrfError;
  }

  const authHeader = resolveBearerToken(request);
  if (!authHeader) {
    return NextResponse.json({ error: "MISSING_AUTH_TOKEN" }, { status: 401 });
  }

  const incoming = await request.formData();
  const outbound = new FormData();
  for (const [key, value] of incoming.entries()) {
    outbound.append(key, value);
  }

  const response = await fetch(`${getApiBaseUrl()}/bulk-import/runs/upload`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      Accept: "application/json",
    },
    body: outbound,
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
