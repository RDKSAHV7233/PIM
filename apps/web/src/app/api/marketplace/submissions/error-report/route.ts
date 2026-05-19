// apps/web/src/app/api/marketplace/submissions/error-report/route.ts
// CSV download route — fetches REJECTED + ERROR submissions and streams as CSV.
// Supports optional ?connectorSlug=amazon-in query param.

import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl } from "@/lib/api-base-url";
import { resolveBearerToken } from "../../../_auth";

function escapeCsv(value: unknown): string {
  const str = value == null ? "" : String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function rowToCsv(cols: unknown[]): string {
  return cols.map(escapeCsv).join(",");
}

interface SubmissionIssue {
  code: string;
  fieldPath: string | null;
  severity: string;
  sellerMessage: string;
}

interface SubmissionRecord {
  id: string;
  productId: string;
  connectorSlug: string;
  connectorDisplayName: string;
  status: string;
  attemptNumber: number;
  submittedAt: string;
  resolvedAt: string | null;
  channelErrors: SubmissionIssue[];
}

function parseItems(data: unknown): SubmissionRecord[] {
  if (!data) return [];
  if (Array.isArray(data)) return data as SubmissionRecord[];
  if (
    typeof data === "object" &&
    data !== null &&
    "items" in data &&
    Array.isArray((data as Record<string, unknown>).items)
  ) {
    return (data as { items: SubmissionRecord[] }).items;
  }
  return [];
}

async function fetchSubmissions(
  baseUrl: string,
  authHeader: string,
  status: string,
  connectorSlug: string,
): Promise<SubmissionRecord[] | null> {
  const params = new URLSearchParams({ status, limit: "500" });
  if (connectorSlug) {
    params.set("connectorSlug", connectorSlug);
  }
  const resp = await fetch(`${baseUrl}/submissions?${params.toString()}`, {
    headers: { Authorization: authHeader, Accept: "application/json" },
    cache: "no-store",
  });
  if (!resp.ok) return null;
  return parseItems(await resp.json());
}

export async function GET(request: NextRequest) {
  const authHeader = resolveBearerToken(request);
  if (!authHeader) {
    return NextResponse.json({ error: "MISSING_AUTH_TOKEN" }, { status: 401 });
  }

  const url = new URL(request.url);
  const connectorSlug = url.searchParams.get("connectorSlug") ?? "";
  const statusFilter = url.searchParams.get("status") ?? "";

  const baseUrl = getApiBaseUrl();
  let submissions: SubmissionRecord[];

  if (statusFilter) {
    // Single-status request (e.g. ?status=REJECTED for filtered view)
    const rows = await fetchSubmissions(baseUrl, authHeader, statusFilter, connectorSlug);
    if (rows === null) {
      return NextResponse.json({ error: "UPSTREAM_ERROR" }, { status: 502 });
    }
    submissions = rows;
  } else {
    // Default: fetch REJECTED + ERROR together
    const [rejected, errored] = await Promise.all([
      fetchSubmissions(baseUrl, authHeader, "REJECTED", connectorSlug),
      fetchSubmissions(baseUrl, authHeader, "ERROR", connectorSlug),
    ]);
    if (rejected === null || errored === null) {
      return NextResponse.json({ error: "UPSTREAM_ERROR" }, { status: 502 });
    }
    submissions = [...rejected, ...errored];
  }

  // Build CSV — one row per channel error; submissions with no errors get one summary row
  const headerRow = rowToCsv([
    "Submission ID",
    "Product ID",
    "Connector",
    "Status",
    "Attempt",
    "Submitted At",
    "Resolved At",
    "Error Code",
    "Field Path",
    "Message",
    "Severity",
  ]);

  const dataRows: string[] = [];
  for (const submission of submissions) {
    if (submission.channelErrors.length === 0) {
      dataRows.push(
        rowToCsv([
          submission.id,
          submission.productId,
          submission.connectorSlug,
          submission.status,
          submission.attemptNumber,
          submission.submittedAt,
          submission.resolvedAt ?? "",
          "",
          "",
          "",
          "",
        ]),
      );
    } else {
      for (const issue of submission.channelErrors) {
        dataRows.push(
          rowToCsv([
            submission.id,
            submission.productId,
            submission.connectorSlug,
            submission.status,
            submission.attemptNumber,
            submission.submittedAt,
            submission.resolvedAt ?? "",
            issue.code,
            issue.fieldPath ?? "",
            issue.sellerMessage,
            issue.severity,
          ]),
        );
      }
    }
  }

  const csv = [headerRow, ...dataRows].join("\r\n");
  const dateTag = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const filename = connectorSlug
    ? `submissions-error-report-${connectorSlug}-${dateTag}.csv`
    : `submissions-error-report-${dateTag}.csv`;

  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
