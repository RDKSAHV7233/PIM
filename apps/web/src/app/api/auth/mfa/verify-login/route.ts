import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { getApiBaseUrl } from "@/lib/api-base-url";

function useSecureCookies(): boolean {
  const appEnv = String(process.env.APP_ENV ?? process.env.NODE_ENV ?? "").trim().toLowerCase();
  return appEnv === "production" || appEnv === "staging";
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as Record<string, unknown>;
  const pendingToken = String(body?.pendingToken ?? "").trim();
  const code = String(body?.code ?? "").trim();

  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}/auth/mfa/verify-login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${pendingToken}`,
      },
      body: JSON.stringify({ code }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "AUTH_UPSTREAM_UNAVAILABLE" }, { status: 503 });
  }

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
          { status: 200 },
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
        return outgoing;
      }
    } catch {
      // fall through to raw response
    }
  }

  return new NextResponse(rawBody, {
    status: response.status,
    headers: { "Content-Type": response.headers.get("content-type") ?? "application/json" },
  });
}
