import { NextRequest, NextResponse } from "next/server";
import {
  ApiHttpError,
  getDashboardHealth,
  getDashboardOperationsSummary,
} from "@/lib/api";
import { resolveBearerToken } from "../../_auth";

export async function GET(request: NextRequest) {
  const authHeader = resolveBearerToken(request) ?? undefined;

  try {
    const [health, operationsSummary] = await Promise.all([
      getDashboardHealth({ authHeader }),
      getDashboardOperationsSummary({ authHeader }),
    ]);

    return NextResponse.json({
      quality: Number(health.snapshot.openIssuesBlocking ?? 0),
      operations: operationsSummary.failedImportJobs + operationsSummary.jobsNeedingRetry,
    });
  } catch (error: unknown) {
    if (error instanceof ApiHttpError) {
      if (error.body && typeof error.body === "object") {
        return NextResponse.json(error.body, { status: error.status });
      }
      return NextResponse.json(
        { error: "navigation_summary_failed", message: error.message },
        { status: error.status },
      );
    }
    return NextResponse.json({ error: "navigation_summary_failed" }, { status: 500 });
  }
}
