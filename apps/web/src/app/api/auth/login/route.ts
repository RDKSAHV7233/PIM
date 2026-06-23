import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getApiBaseUrl } from "@/lib/api-base-url";

function useSecureCookies(): boolean {
  const appEnv = String(process.env.APP_ENV ?? process.env.NODE_ENV ?? "").trim().toLowerCase();
  return appEnv === "production" || appEnv === "staging";
}

function extractCookieValue(setCookieHeader: string | null, name: string): string | null {
  if (!setCookieHeader) return null;
  const pattern = new RegExp(`(?:^|,\\s*)${name}=([^;]+)`);
  const match = setCookieHeader.match(pattern);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
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
  const apiBaseUrl = getApiBaseUrl();

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
      },
      body: JSON.stringify(loginPayload),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    return NextResponse.json(
      { error: "AUTH_UPSTREAM_UNAVAILABLE" },
      { status: 503 },
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
        const refreshToken = extractCookieValue(response.headers.get("set-cookie"), "pim_refresh_token");
        if (refreshToken) {
          outgoing.cookies.set("pim_refresh_token", refreshToken, {
            httpOnly: true,
            secure: secureCookies,
            sameSite: "strict",
            path: "/",
            maxAge: 7 * 24 * 60 * 60,
          });
        }
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
