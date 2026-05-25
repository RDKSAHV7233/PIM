import { Prisma } from "@prisma/client";
import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { normalizeTenantKey } from "../common/tenant/tenant.constants";
import {
  isMarketplaceChannel,
  mapMarketplaceChannelToConnectorSlug,
} from "../marketplace/marketplace-channels";
import { PrismaService } from "../prisma/prisma.service";

export interface MetricEventInput {
  tenantKey: string;
  metricKey: string;
  metricValue: number;
  connectorSlug?: string | null;
  unit?: string | null;
  tags?: Record<string, unknown>;
  observedAt?: Date;
}

type TrendPoint = {
  date: string;
  value: number;
};

type ConnectorTrendPoint = TrendPoint & {
  connectorSlug: string;
};

export interface KpiTrendsResponse {
  tenantId: string;
  rangeDays: number;
  generatedAt: string;
  readinessAccuracy: TrendPoint[];
  throughput: ConnectorTrendPoint[];
  rejectionRate: ConnectorTrendPoint[];
  reliabilityDuplicatePreventionRate: ConnectorTrendPoint[];
  mappingCompletionRate: ConnectorTrendPoint[];
  firstPublishSuccessRate: ConnectorTrendPoint[];
  setupTimeToFirstPublishHours: ConnectorTrendPoint[];
  signupRequests: TrendPoint[];
  signupVerifications: TrendPoint[];
  signupVerificationRate: TrendPoint[];
  signupMedianTimeToVerifyHours: TrendPoint[];
  blockerResolutionRate: TrendPoint[];
  medianBlockerResolutionHours: TrendPoint[];
}

const MAX_TREND_DAYS = 90;
const DEFAULT_TREND_DAYS = 30;
const METRIC_EVENT_KEYS = [
  "readiness.accuracy_percent",
  "throughput.export_jobs_per_second",
  "submission.rejected",
  "submission.total",
  "reliability.duplicate_prevented",
  "reliability.attempt_total",
  "mapping.completion_percent",
  "signup.request_total",
  "signup.verification_total",
  "signup.hours_to_verify",
] as const;
const EXPORT_JOB_TREND_STATUSES = ["completed", "retrying", "failed", "dead_letter"] as const;

type MetricEventRow = {
  observedAt: Date;
  connectorSlug: string | null;
  metricKey: string;
  metricValue: number;
};

type ExportJobTrendRow = {
  updatedAt: Date;
  channel: string;
  status: string;
  retryCount: number;
};

type InstallationTrendRow = {
  connectorId: string;
  installedAt: Date;
};

type ConnectorDefinitionRow = {
  id: string;
  slug: string;
};

type IssueOpenedRow = {
  createdAt: Date;
};

type IssueResolvedRow = {
  createdAt: Date;
  updatedAt: Date;
};

@Injectable()
export class MetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async emit(input: MetricEventInput): Promise<void> {
    const tenantKey = normalizeTenantKey(input.tenantKey);
    const metricKey = String(input.metricKey ?? "").trim();
    const connectorSlug = input.connectorSlug ? String(input.connectorSlug).trim().toLowerCase() : null;
    const unit = input.unit ? String(input.unit).trim().toLowerCase() : null;
    if (!metricKey) {
      return;
    }
    if (!Number.isFinite(input.metricValue)) {
      return;
    }

    const tags = (input.tags ?? {}) as Prisma.InputJsonValue;
    const observedAt = input.observedAt ?? new Date();

    await this.prisma.tenant(tenantKey).kpiMetricEvent.create({
      data: {
        id: randomUUID(),
        tenantKey,
        connectorSlug,
        metricKey,
        metricValue: Number(input.metricValue),
        unit,
        tags,
        observedAt,
      },
    });
  }

  async getKpiTrends(tenantKeyInput: string, daysInput?: number): Promise<KpiTrendsResponse> {
    const tenantKey = normalizeTenantKey(tenantKeyInput);
    const rangeDays = this.resolveTrendDays(daysInput);
    const fromDate = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000);
    const tenantClient = this.prisma.tenant(tenantKey);
    const [metricEvents, exportJobs, installations, openedIssues, resolvedIssues] = await Promise.all([
      tenantClient.kpiMetricEvent.findMany({
        where: {
          observedAt: { gte: fromDate },
          metricKey: { in: [...METRIC_EVENT_KEYS] },
        },
        select: {
          observedAt: true,
          connectorSlug: true,
          metricKey: true,
          metricValue: true,
        },
        take: 50_000, // Trend accuracy degrades gracefully beyond this; OOM risk otherwise.
      }),
      tenantClient.marketplaceExportJob.findMany({
        where: {
          updatedAt: { gte: fromDate },
          status: { in: [...EXPORT_JOB_TREND_STATUSES] },
        },
        select: {
          updatedAt: true,
          channel: true,
          status: true,
          retryCount: true,
        },
        take: 50_000, // Same ceiling as kpiMetricEvent — prevents OOM on very active tenants.
      }),
      tenantClient.connectorInstallation.findMany({
        select: {
          connectorId: true,
          installedAt: true,
        },
        take: 500,
      }),
      tenantClient.validationIssue.findMany({
        where: {
          severity: "error",
          createdAt: { gte: fromDate },
        },
        select: {
          createdAt: true,
        },
        take: 10_000,
      }),
      tenantClient.validationIssue.findMany({
        where: {
          severity: "error",
          status: "resolved",
          updatedAt: { gte: fromDate },
        },
        select: {
          createdAt: true,
          updatedAt: true,
        },
        take: 10_000,
      }),
    ]);

    const connectorDefinitionIds = Array.from(new Set(installations.map((row) => row.connectorId).filter(Boolean)));
    const connectorDefinitions = connectorDefinitionIds.length
      ? await tenantClient.connectorDefinition.findMany({
          where: {
            id: {
              in: connectorDefinitionIds,
            },
          },
          take: 500,
          select: {
            id: true,
            slug: true,
          },
        })
      : [];

    const readinessRows = this.buildAverageMetricTrend(metricEvents, "readiness.accuracy_percent", 2);
    const throughputRows = this.buildAverageConnectorMetricTrend(metricEvents, "throughput.export_jobs_per_second", 4);
    const rejectionRows = this.buildConnectorRateTrend(metricEvents, "submission.rejected", "submission.total");
    const reliabilityRows = this.buildConnectorRateTrend(
      metricEvents,
      "reliability.duplicate_prevented",
      "reliability.attempt_total",
    );
    const mappingCompletionRows = this.buildAverageConnectorMetricTrend(metricEvents, "mapping.completion_percent", 2);
    const firstPublishRows = this.buildFirstPublishSuccessRate(exportJobs);
    const setupTimeRows = this.buildSetupTimeToFirstPublish(installations, connectorDefinitions, exportJobs, fromDate);
    const signupRows = this.buildSignupRows(metricEvents);
    const signupTimeToVerifyRows = this.buildMedianMetricTrend(metricEvents, "signup.hours_to_verify", 2);
    const blockerResolutionRows = this.buildBlockerResolutionRate(openedIssues, resolvedIssues);
    const blockerResolutionTimeRows = this.buildMedianBlockerResolutionHours(resolvedIssues);

    return {
      tenantId: tenantKey,
      rangeDays,
      generatedAt: new Date().toISOString(),
      readinessAccuracy: readinessRows.map((row) => ({
        date: row.date,
        value: this.roundMetric(row.value, 2),
      })),
      throughput: throughputRows.map((row) => ({
        date: row.date,
        connectorSlug: row.connectorSlug,
        value: this.roundMetric(row.value, 4),
      })),
      rejectionRate: rejectionRows,
      reliabilityDuplicatePreventionRate: reliabilityRows,
      mappingCompletionRate: mappingCompletionRows.map((row) => ({
        date: row.date,
        connectorSlug: row.connectorSlug,
        value: this.roundMetric(row.value, 2),
      })),
      firstPublishSuccessRate: firstPublishRows,
      setupTimeToFirstPublishHours: setupTimeRows.map((row) => ({
        date: row.date,
        connectorSlug: row.connectorSlug,
        value: this.roundMetric(row.value, 2),
      })),
      signupRequests: signupRows.map((row) => ({
        date: row.date,
        value: this.roundMetric(row.requested, 2),
      })),
      signupVerifications: signupRows.map((row) => ({
        date: row.date,
        value: this.roundMetric(row.verified, 2),
      })),
      signupVerificationRate: this.buildSignupConversionRate(signupRows),
      signupMedianTimeToVerifyHours: signupTimeToVerifyRows.map((row) => ({
        date: row.date,
        value: this.roundMetric(row.value, 2),
      })),
      blockerResolutionRate: blockerResolutionRows,
      medianBlockerResolutionHours: blockerResolutionTimeRows.map((row) => ({
        date: row.date,
        value: this.roundMetric(row.value, 2),
      })),
    };
  }

  private buildAverageMetricTrend(events: MetricEventRow[], metricKey: string, digits: number): TrendPoint[] {
    const totals = new Map<string, { total: number; count: number }>();

    for (const event of events) {
      if (event.metricKey !== metricKey) {
        continue;
      }
      const date = this.toDateKey(event.observedAt);
      const current = totals.get(date) ?? { total: 0, count: 0 };
      current.total += Number(event.metricValue ?? 0);
      current.count += 1;
      totals.set(date, current);
    }

    return Array.from(totals.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, value]) => ({
        date,
        value: this.roundMetric(value.count > 0 ? value.total / value.count : 0, digits),
      }));
  }

  private buildAverageConnectorMetricTrend(
    events: MetricEventRow[],
    metricKey: string,
    digits: number,
  ): ConnectorTrendPoint[] {
    const totals = new Map<string, { date: string; connectorSlug: string; total: number; count: number }>();

    for (const event of events) {
      if (event.metricKey !== metricKey) {
        continue;
      }
      const date = this.toDateKey(event.observedAt);
      const connectorSlug = this.normalizeConnectorSlug(event.connectorSlug);
      const key = `${date}::${connectorSlug}`;
      const current = totals.get(key) ?? { date, connectorSlug, total: 0, count: 0 };
      current.total += Number(event.metricValue ?? 0);
      current.count += 1;
      totals.set(key, current);
    }

    return Array.from(totals.values())
      .sort((left, right) => left.date.localeCompare(right.date) || left.connectorSlug.localeCompare(right.connectorSlug))
      .map((row) => ({
        date: row.date,
        connectorSlug: row.connectorSlug,
        value: this.roundMetric(row.count > 0 ? row.total / row.count : 0, digits),
      }));
  }

  private buildConnectorRateTrend(
    events: MetricEventRow[],
    numeratorKey: string,
    denominatorKey: string,
  ): ConnectorTrendPoint[] {
    const aggregates = new Map<string, { date: string; connectorSlug: string; numerator: number; denominator: number }>();

    for (const event of events) {
      if (event.metricKey !== numeratorKey && event.metricKey !== denominatorKey) {
        continue;
      }
      const date = this.toDateKey(event.observedAt);
      const connectorSlug = this.normalizeConnectorSlug(event.connectorSlug);
      const key = `${date}::${connectorSlug}`;
      const current = aggregates.get(key) ?? { date, connectorSlug, numerator: 0, denominator: 0 };
      if (event.metricKey === numeratorKey) {
        current.numerator += Number(event.metricValue ?? 0);
      }
      if (event.metricKey === denominatorKey) {
        current.denominator += Number(event.metricValue ?? 0);
      }
      aggregates.set(key, current);
    }

    return Array.from(aggregates.values())
      .filter((row) => row.denominator > 0)
      .sort((left, right) => left.date.localeCompare(right.date) || left.connectorSlug.localeCompare(right.connectorSlug))
      .map((row) => ({
        date: row.date,
        connectorSlug: row.connectorSlug,
        value: this.roundMetric((row.numerator / row.denominator) * 100, 2),
      }));
  }

  private buildFirstPublishSuccessRate(exportJobs: ExportJobTrendRow[]): ConnectorTrendPoint[] {
    const aggregates = new Map<string, { date: string; connectorSlug: string; successful: number; total: number }>();

    for (const job of exportJobs) {
      const date = this.toDateKey(job.updatedAt);
      const connectorSlug = this.normalizeChannelSlug(job.channel);
      const key = `${date}::${connectorSlug}`;
      const current = aggregates.get(key) ?? { date, connectorSlug, successful: 0, total: 0 };
      current.total += 1;
      if (job.status === "completed" && Number(job.retryCount ?? 0) === 0) {
        current.successful += 1;
      }
      aggregates.set(key, current);
    }

    return Array.from(aggregates.values())
      .filter((row) => row.total > 0)
      .sort((left, right) => left.date.localeCompare(right.date) || left.connectorSlug.localeCompare(right.connectorSlug))
      .map((row) => ({
        date: row.date,
        connectorSlug: row.connectorSlug,
        value: this.roundMetric((row.successful / row.total) * 100, 2),
      }));
  }

  private buildSetupTimeToFirstPublish(
    installations: InstallationTrendRow[],
    connectorDefinitions: ConnectorDefinitionRow[],
    exportJobs: ExportJobTrendRow[],
    fromDate: Date,
  ): ConnectorTrendPoint[] {
    const slugByConnectorId = new Map(connectorDefinitions.map((row) => [row.id, row.slug]));
    const completedByConnector = new Map<string, Date[]>();

    for (const job of exportJobs) {
      if (job.status !== "completed") {
        continue;
      }
      const connectorSlug = this.normalizeChannelSlug(job.channel);
      const rows = completedByConnector.get(connectorSlug) ?? [];
      rows.push(job.updatedAt);
      completedByConnector.set(connectorSlug, rows);
    }

    for (const rows of completedByConnector.values()) {
      rows.sort((left, right) => left.getTime() - right.getTime());
    }

    const aggregates = new Map<string, { date: string; connectorSlug: string; totalHours: number; count: number }>();

    for (const installation of installations) {
      const connectorSlug = slugByConnectorId.get(installation.connectorId);
      if (!connectorSlug) {
        continue;
      }
      const completedRows = completedByConnector.get(connectorSlug);
      if (!completedRows?.length) {
        continue;
      }
      const firstCompletedAt = completedRows.find((value) => value.getTime() >= installation.installedAt.getTime());
      if (!firstCompletedAt || firstCompletedAt.getTime() < fromDate.getTime()) {
        continue;
      }

      const date = this.toDateKey(firstCompletedAt);
      const key = `${date}::${connectorSlug}`;
      const current = aggregates.get(key) ?? { date, connectorSlug, totalHours: 0, count: 0 };
      current.totalHours += (firstCompletedAt.getTime() - installation.installedAt.getTime()) / (60 * 60 * 1000);
      current.count += 1;
      aggregates.set(key, current);
    }

    return Array.from(aggregates.values())
      .sort((left, right) => left.date.localeCompare(right.date) || left.connectorSlug.localeCompare(right.connectorSlug))
      .map((row) => ({
        date: row.date,
        connectorSlug: row.connectorSlug,
        value: this.roundMetric(row.count > 0 ? row.totalHours / row.count : 0, 2),
      }));
  }

  private buildSignupRows(events: MetricEventRow[]): Array<{ date: string; requested: number; verified: number }> {
    const signupRows = new Map<string, { requested: number; verified: number }>();

    for (const event of events) {
      if (event.metricKey !== "signup.request_total" && event.metricKey !== "signup.verification_total") {
        continue;
      }
      const date = this.toDateKey(event.observedAt);
      const current = signupRows.get(date) ?? { requested: 0, verified: 0 };
      if (event.metricKey === "signup.request_total") {
        current.requested += Number(event.metricValue ?? 0);
      }
      if (event.metricKey === "signup.verification_total") {
        current.verified += Number(event.metricValue ?? 0);
      }
      signupRows.set(date, current);
    }

    return Array.from(signupRows.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, value]) => ({
        date,
        requested: value.requested,
        verified: value.verified,
      }));
  }

  private buildMedianMetricTrend(events: MetricEventRow[], metricKey: string, digits: number): TrendPoint[] {
    const valuesByDate = new Map<string, number[]>();

    for (const event of events) {
      if (event.metricKey !== metricKey) {
        continue;
      }
      const date = this.toDateKey(event.observedAt);
      const values = valuesByDate.get(date) ?? [];
      values.push(Number(event.metricValue ?? 0));
      valuesByDate.set(date, values);
    }

    return Array.from(valuesByDate.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, values]) => ({
        date,
        value: this.roundMetric(this.calculateMedian(values), digits),
      }));
  }

  private buildBlockerResolutionRate(openedIssues: IssueOpenedRow[], resolvedIssues: IssueResolvedRow[]): TrendPoint[] {
    const rowsByDate = new Map<string, { opened: number; resolved: number }>();

    for (const issue of openedIssues) {
      const date = this.toDateKey(issue.createdAt);
      const current = rowsByDate.get(date) ?? { opened: 0, resolved: 0 };
      current.opened += 1;
      rowsByDate.set(date, current);
    }

    for (const issue of resolvedIssues) {
      const date = this.toDateKey(issue.updatedAt);
      const current = rowsByDate.get(date) ?? { opened: 0, resolved: 0 };
      current.resolved += 1;
      rowsByDate.set(date, current);
    }

    return Array.from(rowsByDate.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, value]) => {
        const denominator = value.opened + value.resolved;
        return {
          date,
          value: this.roundMetric(denominator > 0 ? (value.resolved / denominator) * 100 : 0, 2),
        };
      });
  }

  private buildMedianBlockerResolutionHours(resolvedIssues: IssueResolvedRow[]): TrendPoint[] {
    const valuesByDate = new Map<string, number[]>();

    for (const issue of resolvedIssues) {
      const date = this.toDateKey(issue.updatedAt);
      const values = valuesByDate.get(date) ?? [];
      values.push((issue.updatedAt.getTime() - issue.createdAt.getTime()) / (60 * 60 * 1000));
      valuesByDate.set(date, values);
    }

    return Array.from(valuesByDate.entries())
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, values]) => ({
        date,
        value: this.roundMetric(this.calculateMedian(values), 2),
      }));
  }

  private calculateMedian(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
      return (sorted[middle - 1] + sorted[middle]) / 2;
    }
    return sorted[middle];
  }

  private normalizeChannelSlug(channel: string | null | undefined): string {
    const normalized = String(channel ?? "").trim().toLowerCase();
    if (isMarketplaceChannel(normalized)) {
      return mapMarketplaceChannelToConnectorSlug(normalized);
    }
    return normalized || "unknown";
  }

  private normalizeConnectorSlug(connectorSlug: string | null | undefined): string {
    const normalized = String(connectorSlug ?? "").trim().toLowerCase();
    return normalized || "unknown";
  }

  private toDateKey(value: Date): string {
    return value.toISOString().slice(0, 10);
  }

  private resolveTrendDays(input?: number): number {
    const parsed = Number(input ?? DEFAULT_TREND_DAYS);
    if (!Number.isFinite(parsed)) {
      return DEFAULT_TREND_DAYS;
    }
    return Math.max(1, Math.min(MAX_TREND_DAYS, Math.floor(parsed)));
  }

  private roundMetric(value: number, digits: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }
    return Number(value.toFixed(digits));
  }

  private buildSignupConversionRate(rows: Array<{ date: string; requested: number; verified: number }>): TrendPoint[] {
    let cumulativeRequested = 0;
    let cumulativeVerified = 0;

    return rows.map((row) => {
      cumulativeRequested += Number(row.requested ?? 0);
      cumulativeVerified += Number(row.verified ?? 0);
      return {
        date: row.date,
        value: this.roundMetric(cumulativeRequested > 0 ? (cumulativeVerified / cumulativeRequested) * 100 : 0, 2),
      };
    });
  }
}
