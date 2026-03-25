import { NextRequest, NextResponse } from "next/server";
import { isPublicSignupEnabled } from "@/lib/public-signup";

export function getApiBaseUrl(): string {
  const value = String(process.env.PIM_API_BASE_URL ?? "").trim();
  return value || "http://localhost:4000/api/v1";
}

export function signupFeatureDisabledResponse() {
  return NextResponse.json({ error: "FEATURE_DISABLED" }, { status: 404 });
}

export async function forwardSignupRequest(
  request: NextRequest,
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
) {
  if (!isPublicSignupEnabled()) {
    return signupFeatureDisabledResponse();
  }

  const forwardedFor = request.headers.get("x-forwarded-for");
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    method: init.method,
    headers: {
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
    },
    ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
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
