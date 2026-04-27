import { NextRequest, NextResponse } from "next/server";
import {
  ApiHttpError,
  getDashboardHealth,
  getDashboardOperationsSummary,
} from "@/lib/api";
import { canEditWorkspace } from "@/lib/role-capabilities";
import { getServerActorRole } from "@/lib/server-session";
import { resolveBearerToken } from "../../_auth";

export async function GET(request: NextRequest) {
  const role = await getServerActorRole();
  const authHeader = resolveBearerToken(request) ?? undefined;
  const canViewOperationsSummary = canEditWorkspace(role);

  try {
    const [health, operationsSummary] = await Promise.all([
      getDashboardHealth({ role, authHeader }),
      canViewOperationsSummary
        ? getDashboardOperationsSummary({ role, authHeader })
        : Promise.resolve(null),
    ]);

    return NextResponse.json({
      quality: Number(health.snapshot.openIssuesBlocking ?? 0),
      operations: operationsSummary
        ? Number(operationsSummary.failedImportJobs ?? 0) + Number(operationsSummary.jobsNeedingRetry ?? 0)
        : 0,
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
