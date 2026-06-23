import { NextRequest, NextResponse } from "next/server";
import { ApiHttpError, getBillingUsage } from "@/lib/api";
import { resolveBearerToken } from "../../_auth";

export async function GET(request: NextRequest) {
  const authHeader = resolveBearerToken(request) ?? undefined;

  try {
    const usage = await getBillingUsage({ authHeader });
    return NextResponse.json(usage);
  } catch (error: unknown) {
    if (error instanceof ApiHttpError) {
      if (error.body && typeof error.body === "object") {
        return NextResponse.json(error.body, { status: error.status });
      }
      return NextResponse.json(
        { error: "billing_usage_failed" },
        { status: error.status },
      );
    }
    return NextResponse.json({ error: "billing_usage_failed" }, { status: 500 });
  }
}
