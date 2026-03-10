import { NextRequest, NextResponse } from "next/server";
import { ApiHttpError, getNotifications, markAllNotificationsRead } from "@/lib/api";
import { resolveBearerToken, validateCsrf } from "../_auth";

export async function GET(request: NextRequest) {
  const authHeader = resolveBearerToken(request) ?? undefined;
  const limit = Number(request.nextUrl.searchParams.get("limit") ?? "12");
  const cursor = request.nextUrl.searchParams.get("cursor");

  try {
    const payload = await getNotifications({ limit, cursor }, { authHeader });
    return NextResponse.json(payload);
  } catch (error: unknown) {
    if (error instanceof ApiHttpError) {
      if (error.body && typeof error.body === "object") {
        return NextResponse.json(error.body, { status: error.status });
      }
      return NextResponse.json({ error: "notifications_list_failed", message: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "notifications_list_failed" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const csrfError = validateCsrf(request);
  if (csrfError) {
    return csrfError;
  }

  const authHeader = resolveBearerToken(request) ?? undefined;
  try {
    const payload = await markAllNotificationsRead({ authHeader });
    return NextResponse.json(payload);
  } catch (error: unknown) {
    if (error instanceof ApiHttpError) {
      if (error.body && typeof error.body === "object") {
        return NextResponse.json(error.body, { status: error.status });
      }
      return NextResponse.json({ error: "notifications_mark_all_failed", message: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "notifications_mark_all_failed" }, { status: 500 });
  }
}
