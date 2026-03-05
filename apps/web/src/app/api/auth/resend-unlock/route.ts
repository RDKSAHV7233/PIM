import { NextRequest, NextResponse } from "next/server";

function getApiBaseUrl(): string {
  const value = String(process.env.PIM_API_BASE_URL ?? "").trim();
  return value || "http://localhost:4000/api/v1";
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const response = await fetch(`${getApiBaseUrl()}/auth/resend-unlock`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    cache: "no-store",
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
