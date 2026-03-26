import { NextRequest, NextResponse } from "next/server";
import { getKpiTrends } from "@/lib/api";
import { getServerActorRole } from "@/lib/server-session";
import { resolveBearerToken } from "../../../../_auth";

function resolveTrendDays(input: string | null): number {
  const parsed = Number.parseInt(String(input ?? ""), 10);
  if (!Number.isFinite(parsed)) {
    return 30;
  }
  return Math.max(1, Math.min(90, parsed));
}

function escapeCsvCell(value: string | number): string {
  const stringValue = String(value ?? "");
  if (/[",\n]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

export async function GET(request: NextRequest) {
  const authHeader = resolveBearerToken(request);
  if (!authHeader) {
    return NextResponse.json({ error: "MISSING_AUTH_TOKEN" }, { status: 401 });
  }

  const role = await getServerActorRole();
  if (role !== "admin") {
    return NextResponse.json({ error: "FORBIDDEN" }, { status: 403 });
  }

  const days = resolveTrendDays(request.nextUrl.searchParams.get("days"));
  const trends = await getKpiTrends({ days }, { role, authHeader });

  const rows = new Map<
    string,
    {
      date: string;
      signups: number;
      verified: number;
      verificationRate: number;
      medianVerifyHours: number | null;
    }
  >();

  for (const point of trends.signupRequests) {
    rows.set(point.date, {
      date: point.date,
      signups: point.value,
      verified: 0,
      verificationRate: 0,
      medianVerifyHours: null,
    });
  }
  for (const point of trends.signupVerifications) {
    const existing = rows.get(point.date) ?? {
      date: point.date,
      signups: 0,
      verified: 0,
      verificationRate: 0,
      medianVerifyHours: null,
    };
    existing.verified = point.value;
    rows.set(point.date, existing);
  }
  for (const point of trends.signupVerificationRate) {
    const existing = rows.get(point.date) ?? {
      date: point.date,
      signups: 0,
      verified: 0,
      verificationRate: 0,
      medianVerifyHours: null,
    };
    existing.verificationRate = point.value;
    rows.set(point.date, existing);
  }
  for (const point of trends.signupMedianTimeToVerifyHours) {
    const existing = rows.get(point.date) ?? {
      date: point.date,
      signups: 0,
      verified: 0,
      verificationRate: 0,
      medianVerifyHours: null,
    };
    existing.medianVerifyHours = point.value;
    rows.set(point.date, existing);
  }

  const orderedRows = Array.from(rows.values()).sort((left, right) => left.date.localeCompare(right.date));
  const csvLines = [
    "date,signups,verified,verification_rate,median_verify_hours",
    ...orderedRows.map((row) =>
      [
        escapeCsvCell(row.date),
        escapeCsvCell(Math.round(row.signups)),
        escapeCsvCell(Math.round(row.verified)),
        escapeCsvCell(Number(row.verificationRate.toFixed(2))),
        escapeCsvCell(row.medianVerifyHours == null ? "" : Number(row.medianVerifyHours.toFixed(2))),
      ].join(","),
    ),
  ];
  const body = `${csvLines.join("\n")}\n`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="tej-pim-signup-trends-${days}d.csv"`,
    },
  });
}
