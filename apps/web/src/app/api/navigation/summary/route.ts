import { NextRequest, NextResponse } from "next/server";
import {
  ApiHttpError,
  getBulkImportJobs,
  getDashboardHealth,
  getDeadLetterSubmissions,
  getSubmissions,
} from "@/lib/api";
import { resolveBearerToken } from "../../_auth";

export async function GET(request: NextRequest) {
  const authHeader = resolveBearerToken(request) ?? undefined;

  try {
    const [health, submissionsResponse, deadLetterResponse, imports] = await Promise.all([
      getDashboardHealth({ authHeader }),
      getSubmissions({ limit: 200 }, { authHeader }),
      getDeadLetterSubmissions({ limit: 200 }, { authHeader }),
      getBulkImportJobs({ authHeader }),
    ]);
    const submissions = Array.isArray(submissionsResponse)
      ? submissionsResponse
      : submissionsResponse.items ?? [];
    const deadLetterJobs = Array.isArray(deadLetterResponse)
      ? deadLetterResponse
      : deadLetterResponse.items ?? [];
    const failedSubmissionJobs = submissions.filter((submission) => {
      const status = String(submission.status ?? "").toUpperCase();
      return status === "REJECTED" || status === "ERROR";
    }).length;
    const failedImportJobs = imports.filter((job) => job.status === "failed" || job.status === "dead_letter").length;

    return NextResponse.json({
      quality: Number(health.snapshot.openIssuesBlocking ?? 0),
      operations: failedImportJobs + failedSubmissionJobs + deadLetterJobs.length,
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
