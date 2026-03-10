import { NextRequest, NextResponse } from "next/server";
import { ApiHttpError, markNotificationRead } from "@/lib/api";
import { resolveBearerToken, validateCsrf } from "../../../_auth";

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const csrfError = validateCsrf(request);
  if (csrfError) {
    return csrfError;
  }

  const authHeader = resolveBearerToken(request) ?? undefined;
  const params = await context.params;
  try {
    const payload = await markNotificationRead(params.id, { authHeader });
    return NextResponse.json(payload);
  } catch (error: unknown) {
    if (error instanceof ApiHttpError) {
      if (error.body && typeof error.body === "object") {
        return NextResponse.json(error.body, { status: error.status });
      }
      return NextResponse.json({ error: "notification_mark_failed", message: error.message }, { status: error.status });
    }
    return NextResponse.json({ error: "notification_mark_failed" }, { status: 500 });
  }
}
