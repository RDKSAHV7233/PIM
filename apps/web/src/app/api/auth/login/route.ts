import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";

function getApiBaseUrl(): string {
  const value = String(process.env.PIM_API_BASE_URL ?? "").trim();
  return value || "http://localhost:4000/api/v1";
}

function useSecureCookies(): boolean {
  const appEnv = String(process.env.APP_ENV ?? process.env.NODE_ENV ?? "").trim().toLowerCase();
  return appEnv === "production" || appEnv === "staging";
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as Record<string, unknown>;
  const parsedExpiry = Number(body?.expiresInMinutes);
  const workspaceSlug = String(body?.workspaceSlug ?? body?.tenantId ?? "").trim().toLowerCase();
  const loginPayload = {
    ...(workspaceSlug ? { workspaceSlug } : {}),
    ...(body?.tenantId ? { tenantId: String(body.tenantId) } : {}),
    userId: String(body?.userId ?? "").trim(),
    password: String(body?.password ?? ""),
    ...(Number.isFinite(parsedExpiry) ? { expiresInMinutes: Math.trunc(parsedExpiry) } : {}),
  };
  const forwardedFor = request.headers.get("x-forwarded-for");

  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
      },
      body: JSON.stringify(loginPayload),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      {
        error: "AUTH_UPSTREAM_UNAVAILABLE",
      },
      {
        status: 503,
      },
    );
  }

  const retryAfter = response.headers.get("x-ratelimit-retry-after");
  const rawBody = await response.text();

  if (response.ok) {
    try {
      const parsed = JSON.parse(rawBody) as {
        accessToken?: string;
        expiresInSeconds?: number;
        userId?: string;
        tenantId?: string;
        role?: string;
      };
      if (parsed.accessToken) {
        const maxAge = Number.isFinite(parsed.expiresInSeconds) ? Number(parsed.expiresInSeconds) : 4 * 60 * 60;
        const csrfToken = randomUUID();
        const outgoing = NextResponse.json(
          {
            userId: parsed.userId ?? null,
            tenantId: parsed.tenantId ?? null,
            role: parsed.role ?? null,
            expiresInSeconds: parsed.expiresInSeconds ?? maxAge,
          },
          {
            status: response.status,
          },
        );
        const secureCookies = useSecureCookies();
        outgoing.cookies.set("pim_access_token", parsed.accessToken, {
          httpOnly: true,
          secure: secureCookies,
          sameSite: "lax",
          path: "/",
          maxAge,
        });
        outgoing.cookies.set("pim_csrf_token", csrfToken, {
          httpOnly: false,
          secure: secureCookies,
          sameSite: "lax",
          path: "/",
          maxAge,
        });
        if (retryAfter) {
          outgoing.headers.set("X-RateLimit-Retry-After", retryAfter);
        }
        return outgoing;
      }
    } catch {
      // Keep original response body if parsing fails.
    }
  }

  const contentType = response.headers.get("content-type") ?? "application/json";
  const outgoing = new NextResponse(rawBody, {
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
