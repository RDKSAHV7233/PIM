import { NextRequest, NextResponse } from "next/server";
import { resolveBearerToken, validateCsrf } from "../_auth";

function getApiBaseUrl(): string {
  const value = String(process.env.PIM_API_BASE_URL ?? "").trim();
  return value || "http://localhost:4000/api/v1";
}

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
