import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl } from "@/lib/api-base-url";
import { resolveBearerToken } from "../../_auth";

export async function GET(request: NextRequest) {
  const authHeader = resolveBearerToken(request);
  if (!authHeader) {
    return NextResponse.json(
      {
        error: "MISSING_AUTH_TOKEN",
      },
      { status: 401 },
    );
  }

  const response = await fetch(`${getApiBaseUrl()}/auth/account/privacy-status`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: authHeader,
    },
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
