import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl } from "@/lib/api-base-url";

export async function POST(request: NextRequest) {
  const enrollmentToken = request.cookies.get("pim_mfa_enrollment_token")?.value ?? "";

  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}/auth/mfa/enroll`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${enrollmentToken}`,
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
