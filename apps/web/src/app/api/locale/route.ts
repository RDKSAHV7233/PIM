import { NextRequest, NextResponse } from "next/server";
import { PIM_LOCALE_COOKIE, resolveLocale } from "@/lib/locale";

function useSecureCookies(): boolean {
  const appEnv = String(process.env.APP_ENV ?? process.env.NODE_ENV ?? "").trim().toLowerCase();
  return appEnv === "production" || appEnv === "staging";
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as { locale?: string };
  const locale = resolveLocale(body.locale);

  const response = NextResponse.json({
    ok: true,
    locale,
  });
  response.cookies.set(PIM_LOCALE_COOKIE, locale, {
    httpOnly: false,
    sameSite: "lax",
    secure: useSecureCookies(),
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  return response;
}
