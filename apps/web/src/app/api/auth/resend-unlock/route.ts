import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl } from "@/lib/api-base-url";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const response = await fetch(`${getApiBaseUrl()}/auth/resend-unlock`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });

  const contentType = response.headers.get("content-type") ?? "application/json";
  const retryAfter = response.headers.get("x-ratelimit-retry-after");
  const payload = await response.text();
  const outgoing = new NextResponse(payload, {
    status: response.status,
    headers: {
      "Content-Type": contentType,
    },
  });
  if (retryAfter) {
    outgoing.headers.set("X-RateLimit-Retry-After", retryAfter);
  }
  return outgoing;
}
