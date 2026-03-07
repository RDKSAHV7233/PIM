import { Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { normalizeTenantKey } from "../common/tenant/tenant.constants";
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
  blockerResolutionRate: TrendPoint[];
  medianBlockerResolutionHours: TrendPoint[];
}

const MAX_TREND_DAYS = 90;
const DEFAULT_TREND_DAYS = 30;

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

    const tags = input.tags ?? {};
    const observedAt = input.observedAt ?? new Date();

    // RLS-BYPASS: manual tenant filter
    await this.prisma.tenant(tenantKey).$executeRawUnsafe(
      `
      INSERT INTO kpi_metric_events (
        id,
        tenant_key,
        connector_slug,
        metric_key,
        metric_value,
        unit,
        tags,
        observed_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7::jsonb, $8
      )
      `,
      randomUUID(),
      tenantKey,
      connectorSlug,
      metricKey,
      Number(input.metricValue),
      unit,
      JSON.stringify(tags),
      observedAt,
    );
  }

  async getKpiTrends(tenantKeyInput: string, daysInput?: number): Promise<KpiTrendsResponse> {
    const tenantKey = normalizeTenantKey(tenantKeyInput);
    const rangeDays = this.resolveTrendDays(daysInput);
    const fromDate = new Date(Date.now() - rangeDays * 24 * 60 * 60 * 1000);

    // RLS-BYPASS: manual tenant filter
    const readinessRows = await this.prisma.tenant(tenantKey).$queryRawUnsafe<Array<{ date: string; value: number }>>(
      `
      SELECT
        DATE(observed_at)::text AS date,
        ROUND(AVG(metric_value)::numeric, 2)::float8 AS value
      FROM kpi_metric_events
      WHERE tenant_key = $1
        AND metric_key = 'readiness.accuracy_percent'
        AND observed_at >= $2
      GROUP BY DATE(observed_at)
      ORDER BY DATE(observed_at) ASC
      `,
      tenantKey,
      fromDate,
    );

    // RLS-BYPASS: manual tenant filter
    const throughputRows = await this.prisma.tenant(tenantKey).$queryRawUnsafe<
      Array<{ date: string; connectorSlug: string; value: number }>
    >(
      `
      SELECT
        DATE(observed_at)::text AS date,
        COALESCE(connector_slug, 'unknown') AS "connectorSlug",
        ROUND(AVG(metric_value)::numeric, 4)::float8 AS value
      FROM kpi_metric_events
      WHERE tenant_key = $1
        AND metric_key = 'throughput.export_jobs_per_second'
        AND observed_at >= $2
      GROUP BY DATE(observed_at), COALESCE(connector_slug, 'unknown')
      ORDER BY DATE(observed_at) ASC, COALESCE(connector_slug, 'unknown') ASC
      `,
      tenantKey,
      fromDate,
    );

    // RLS-BYPASS: manual tenant filter
    const rejectionRows = await this.prisma.tenant(tenantKey).$queryRawUnsafe<
      Array<{ date: string; connectorSlug: string; rejected: number; total: number }>
    >(
      `
      SELECT
        DATE(observed_at)::text AS date,
        COALESCE(connector_slug, 'unknown') AS "connectorSlug",
        SUM(CASE WHEN metric_key = 'submission.rejected' THEN metric_value ELSE 0 END)::float8 AS rejected,
        SUM(CASE WHEN metric_key = 'submission.total' THEN metric_value ELSE 0 END)::float8 AS total
      FROM kpi_metric_events
      WHERE tenant_key = $1
        AND metric_key IN ('submission.rejected', 'submission.total')
        AND observed_at >= $2
      GROUP BY DATE(observed_at), COALESCE(connector_slug, 'unknown')
      ORDER BY DATE(observed_at) ASC, COALESCE(connector_slug, 'unknown') ASC
      `,
      tenantKey,
      fromDate,
    );

    // RLS-BYPASS: manual tenant filter
    const reliabilityRows = await this.prisma.tenant(tenantKey).$queryRawUnsafe<
      Array<{ date: string; connectorSlug: string; duplicatePrevented: number; attempts: number }>
    >(
      `
      SELECT
        DATE(observed_at)::text AS date,
        COALESCE(connector_slug, 'unknown') AS "connectorSlug",
        SUM(CASE WHEN metric_key = 'reliability.duplicate_prevented' THEN metric_value ELSE 0 END)::float8 AS "duplicatePrevented",
        SUM(CASE WHEN metric_key = 'reliability.attempt_total' THEN metric_value ELSE 0 END)::float8 AS attempts
      FROM kpi_metric_events
      WHERE tenant_key = $1
        AND metric_key IN ('reliability.duplicate_prevented', 'reliability.attempt_total')
        AND observed_at >= $2
      GROUP BY DATE(observed_at), COALESCE(connector_slug, 'unknown')
      ORDER BY DATE(observed_at) ASC, COALESCE(connector_slug, 'unknown') ASC
      `,
      tenantKey,
      fromDate,
    );

    // RLS-BYPASS: manual tenant filter
    const mappingCompletionRows = await this.prisma.tenant(tenantKey).$queryRawUnsafe<
      Array<{ date: string; connectorSlug: string; value: number }>
    >(
      `
      SELECT
        DATE(observed_at)::text AS date,
        COALESCE(connector_slug, 'unknown') AS "connectorSlug",
        ROUND(AVG(metric_value)::numeric, 2)::float8 AS value
      FROM kpi_metric_events
      WHERE tenant_key = $1
        AND metric_key = 'mapping.completion_percent'
        AND observed_at >= $2
      GROUP BY DATE(observed_at), COALESCE(connector_slug, 'unknown')
      ORDER BY DATE(observed_at) ASC, COALESCE(connector_slug, 'unknown') ASC
      `,
      tenantKey,
      fromDate,
    );

    // RLS-BYPASS: manual tenant filter
    const firstPublishRows = await this.prisma.tenant(tenantKey).$queryRawUnsafe<
      Array<{ date: string; connectorSlug: string; successful: number; total: number }>
    >(
      `
      SELECT
        DATE("updatedAt")::text AS date,
        CASE channel::text
          WHEN 'amazon' THEN 'amazon-in'
          ELSE channel::text
        END AS "connectorSlug",
        SUM(CASE WHEN status = 'completed' AND "retryCount" = 0 THEN 1 ELSE 0 END)::float8 AS successful,
        SUM(CASE WHEN status IN ('completed', 'retrying', 'failed', 'dead_letter') THEN 1 ELSE 0 END)::float8 AS total
      FROM "MarketplaceExportJob"
      WHERE "tenantKey" = $1
        AND "updatedAt" >= $2
      GROUP BY DATE("updatedAt"), CASE channel::text
        WHEN 'amazon' THEN 'amazon-in'
        ELSE channel::text
      END
      ORDER BY DATE("updatedAt") ASC, CASE channel::text
        WHEN 'amazon' THEN 'amazon-in'
        ELSE channel::text
      END ASC
      `,
      tenantKey,
      fromDate,
    );

    // RLS-BYPASS: manual tenant filter
    const setupTimeRows = await this.prisma.tenant(tenantKey).$queryRawUnsafe<
      Array<{ date: string; connectorSlug: string; value: number }>
    >(
      `
      SELECT
        DATE(inst.first_completed_at)::text AS date,
        inst.connector_slug AS "connectorSlug",
        ROUND(AVG(inst.hours_to_first_publish)::numeric, 2)::float8 AS value
      FROM (
        SELECT
          cd.slug AS connector_slug,
          first_job.first_completed_at,
          EXTRACT(EPOCH FROM (first_job.first_completed_at - (ci.installed_at AT TIME ZONE 'UTC'))) / 3600.0 AS hours_to_first_publish
        FROM connector_installations ci
        JOIN connector_definitions cd ON cd.id = ci.connector_id
        JOIN LATERAL (
          SELECT MIN(mej."updatedAt") AS first_completed_at
          FROM "MarketplaceExportJob" mej
          WHERE mej."tenantKey" = ci.tenant_key
            AND (
              CASE mej.channel::text
                WHEN 'amazon' THEN 'amazon-in'
                ELSE mej.channel::text
              END
            ) = cd.slug
            AND mej.status = 'completed'
            AND mej."updatedAt" >= (ci.installed_at AT TIME ZONE 'UTC')
        ) first_job ON first_job.first_completed_at IS NOT NULL
        WHERE ci.tenant_key = $1
          AND first_job.first_completed_at >= $2
      ) inst
      GROUP BY DATE(inst.first_completed_at), inst.connector_slug
      ORDER BY DATE(inst.first_completed_at) ASC, inst.connector_slug ASC
      `,
      tenantKey,
      fromDate,
    );

    // RLS-BYPASS: manual tenant filter
    const blockerResolutionRows = await this.prisma.tenant(tenantKey).$queryRawUnsafe<
      Array<{ date: string; resolved: number; opened: number }>
    >(
      `
      WITH opened AS (
        SELECT DATE("createdAt")::text AS date, COUNT(*)::float8 AS opened
        FROM "ValidationIssue"
        WHERE "tenantKey" = $1
          AND severity = 'error'
          AND "createdAt" >= $2
        GROUP BY DATE("createdAt")
      ),
      resolved AS (
        SELECT DATE("updatedAt")::text AS date, COUNT(*)::float8 AS resolved
        FROM "ValidationIssue"
        WHERE "tenantKey" = $1
          AND severity = 'error'
          AND status = 'resolved'
          AND "updatedAt" >= $2
        GROUP BY DATE("updatedAt")
      )
      SELECT
        COALESCE(opened.date, resolved.date) AS date,
        COALESCE(resolved.resolved, 0)::float8 AS resolved,
        COALESCE(opened.opened, 0)::float8 AS opened
      FROM opened
      FULL OUTER JOIN resolved ON resolved.date = opened.date
      ORDER BY COALESCE(opened.date, resolved.date) ASC
      `,
      tenantKey,
      fromDate,
    );

    // RLS-BYPASS: manual tenant filter
    const blockerResolutionTimeRows = await this.prisma.tenant(tenantKey).$queryRawUnsafe<
      Array<{ date: string; value: number }>
    >(
      `
      SELECT
        DATE("updatedAt")::text AS date,
        PERCENTILE_CONT(0.5) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM ("updatedAt" - "createdAt")) / 3600.0
        )::float8 AS value
      FROM "ValidationIssue"
      WHERE "tenantKey" = $1
        AND severity = 'error'
        AND status = 'resolved'
        AND "updatedAt" >= $2
      GROUP BY DATE("updatedAt")
      ORDER BY DATE("updatedAt") ASC
      `,
      tenantKey,
      fromDate,
    );

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
      rejectionRate: rejectionRows
        .filter((row) => row.total > 0)
        .map((row) => ({
          date: row.date,
          connectorSlug: row.connectorSlug,
          value: this.roundMetric((row.rejected / row.total) * 100, 2),
        })),
      reliabilityDuplicatePreventionRate: reliabilityRows
        .filter((row) => row.attempts > 0)
        .map((row) => ({
          date: row.date,
          connectorSlug: row.connectorSlug,
          value: this.roundMetric((row.duplicatePrevented / row.attempts) * 100, 2),
        })),
      mappingCompletionRate: mappingCompletionRows.map((row) => ({
        date: row.date,
        connectorSlug: row.connectorSlug,
        value: this.roundMetric(row.value, 2),
      })),
      firstPublishSuccessRate: firstPublishRows
        .filter((row) => row.total > 0)
        .map((row) => ({
          date: row.date,
          connectorSlug: row.connectorSlug,
          value: this.roundMetric((row.successful / row.total) * 100, 2),
        })),
      setupTimeToFirstPublishHours: setupTimeRows.map((row) => ({
        date: row.date,
        connectorSlug: row.connectorSlug,
        value: this.roundMetric(row.value, 2),
      })),
      blockerResolutionRate: blockerResolutionRows.map((row) => {
        const denominator = row.resolved + row.opened;
        return {
          date: row.date,
          value: this.roundMetric(denominator > 0 ? (row.resolved / denominator) * 100 : 0, 2),
        };
      }),
      medianBlockerResolutionHours: blockerResolutionTimeRows.map((row) => ({
        date: row.date,
        value: this.roundMetric(row.value, 2),
      })),
    };
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
}
