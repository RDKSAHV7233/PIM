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
  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}/bulk-import/validate`, {
      method: "POST",
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body,
      cache: "no-store",
    });
  } catch (error) {
    return NextResponse.json(
      { error: "UPSTREAM_UNAVAILABLE", message: error instanceof Error ? error.message : "API unreachable" },
      { status: 503 },
    );
  }

  const payload = await response.text();
  return new NextResponse(payload, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("content-type") ?? "application/json; charset=utf-8",
    },
  });
}
