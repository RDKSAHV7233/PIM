import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { resolveCurrentCredentialKeyVersion } from "../connector-installer/credential-encryption.util";
import { LoggerService } from "../common/logging/logger.service";
import { runWithAdvisoryLock } from "../common/scheduling/advisory-lock";
import { forEachTenant } from "../common/tenant/tenant-iteration";
import { PrismaDirectService } from "../prisma/prisma-direct.service";
import { ConnectorRegistry } from "./connector.registry";
import { ConnectorCredentialService } from "./connector-credential.service";
import { ConnectorHttpClient } from "./connector-http-client.service";
import { ConnectorContext } from "./connector.interface";
import {
  classifyDetailedResult,
  classifyLegacyBoolean,
  classifyThrown,
  validationColumns,
  type ValidationRecord,
} from "./credential-validation";

const HEARTBEAT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const DEFAULT_INITIAL_DELAY_MS = 30 * 1000;        // 30 seconds after boot

/** CONNECTOR_HEARTBEAT_INITIAL_DELAY_MS lets tests and operators shorten the boot delay; anything invalid keeps the default. */
function resolveInitialDelayMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(String(env.CONNECTOR_HEARTBEAT_INITIAL_DELAY_MS ?? "").trim());
  return Number.isFinite(raw) && raw >= 0 ? Math.floor(raw) : DEFAULT_INITIAL_DELAY_MS;
}
const HEARTBEAT_BATCH_SIZE = 50;                   // process at most 50 installations per tick

type InstallationRow = {
  id: string;
  tenantKey: string;
  connectorId: string;
  slug: string;
};

@Injectable()
export class ConnectorHeartbeatService implements OnApplicationBootstrap, OnApplicationShutdown {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(
    private readonly prismaDirect: PrismaDirectService,
    private readonly registry: ConnectorRegistry,
    private readonly credentialService: ConnectorCredentialService,
    private readonly httpClient: ConnectorHttpClient,
    private readonly logger: LoggerService,
  ) {}

  onApplicationBootstrap() {
    if (String(process.env.CONNECTOR_HEARTBEAT_DISABLED ?? "").trim().toLowerCase() === "true") {
      this.logger.info("Connector credential heartbeat disabled via CONNECTOR_HEARTBEAT_DISABLED.");
      return;
    }
    // Delay first run so the app has time to finish booting and seed DB connections
    this.timer = setTimeout(() => {
      void this.runScheduledStartupTasks();
      this.intervalId = setInterval(() => void this.runScheduledHeartbeat(), HEARTBEAT_INTERVAL_MS);
    }, resolveInitialDelayMs());
  }

  private async runScheduledStartupTasks(): Promise<void> {
    await this.runWithHeartbeatLock("startup", () => this.runStartupTasks());
  }

  private async runScheduledHeartbeat(): Promise<void> {
    await this.runWithHeartbeatLock("heartbeat", () => this.runHeartbeat());
  }

  private async runWithHeartbeatLock(label: string, fn: () => Promise<void>): Promise<void> {
    let ran = false;
    try {
      ran = await runWithAdvisoryLock("connector-heartbeat", async () => {
        try {
          await fn();
        } catch (error: unknown) {
          this.logger.warn("Connector heartbeat scheduled run failed open.", {
            label,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    } catch (error: unknown) {
      this.logger.error("Scheduler lock failure for connector-heartbeat.", {
        error: error instanceof Error ? error.message : String(error),
      });
      return;
    }
    if (!ran) {
      this.logger.info("Skipped connector heartbeat: another replica holds the scheduler lock.", { label });
    }
  }

  private async runStartupTasks(): Promise<void> {
    // Run key rotation check before the first heartbeat — catches version upgrades on deploy
    await this.runKeyRotationIfNeeded();
    await this.runHeartbeat();
  }

  private async runKeyRotationIfNeeded(): Promise<void> {
    const currentVersion = resolveCurrentCredentialKeyVersion(process.env);
    const targetVersion = `v${currentVersion}`;

    // Check, per tenant, whether any credentials are on a stale key version. SEC-DB-RLS-001: this used to be one count through the
    // context-free client, which under row level security sees only the default tenant, so a stale credential of any other tenant
    // would never trigger a rotation. A tenant whose count could not be read is NOT treated as "nothing stale".
    const check = await forEachTenant(this.prismaDirect.getClient(), async (tx) => {
      const stale = await tx.connectorCredential.count({
        where: { keyVersion: { not: targetVersion } },
      });
      return { examinedCount: stale, changedCount: 0 };
    });
    const staleCount = check.examinedTotal;

    if (check.tenantsFailed > 0) {
      this.logger.warn("connector.credential.rotation_check_incomplete", {
        tenantsEvaluated: check.tenantsEvaluated,
        tenantsFailed: check.tenantsFailed,
        staleCountFromReadableTenants: staleCount,
      });
    }

    if (staleCount === 0 && check.tenantsFailed === 0) {
      return;
    }

    this.logger.info("connector.credential.rotation_triggered", {
      staleCount,
      tenantsEvaluated: check.tenantsEvaluated,
      tenantsUnchecked: check.tenantsFailed,
      currentVersion: targetVersion,
    });

    try {
      const result = await this.credentialService.rotateAllCredentials();
      this.logger.info("connector.credential.rotation_result", result);
      if (result.status !== undefined && result.status !== "SUCCESS") {
        this.logger.warn("connector.credential.rotation_degraded", {
          status: result.status,
          tenantsFailed: result.tenants?.tenantsFailed,
          errors: result.errors,
        });
      }
    } catch (err) {
      this.logger.warn("connector.credential.rotation_failed", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  onApplicationShutdown() {
    if (this.timer) clearTimeout(this.timer);
    if (this.intervalId) clearInterval(this.intervalId);
  }

  private async runHeartbeat(): Promise<void> {
    if (this.running) {
      this.logger.warn("Connector heartbeat already running — skipping tick.");
      return;
    }
    this.running = true;
    this.logger.info("Connector credential heartbeat started.");
    const counts = { checked: 0, valid: 0, expired: 0, indeterminate: 0, configurationError: 0, errors: 0 };

    try {
      const installations = await this.loadActiveInstallations();
      for (const inst of installations) {
        let record: ValidationRecord;
        try {
          record = await this.validate(inst);
        } catch (err) {
          // A verifier that throws failed to check; that is not evidence about the credentials.
          counts.errors++;
          record = classifyThrown();
          this.logger.warn("Connector credential heartbeat: error checking installation", {
            installationId: inst.id,
            tenantKey: inst.tenantKey,
            slug: inst.slug,
            error: err instanceof Error ? err.message : String(err),
          });
        }
        try {
          await this.recordOutcome(inst, record);
        } catch (err) {
          counts.errors++;
          this.logger.warn("Connector credential heartbeat: could not record validation outcome", {
            installationId: inst.id,
            tenantKey: inst.tenantKey,
            error: err instanceof Error ? err.message : String(err),
          });
          continue;
        }
        counts.checked++;
        switch (record.outcome) {
          case "VALID":
            counts.valid++;
            break;
          case "INVALID":
            counts.expired++;
            this.logger.warn("Connector credential heartbeat: credentials expired", {
              slug: inst.slug,
              installationId: inst.id,
              tenantKey: inst.tenantKey,
              reason: record.reason,
            });
            break;
          case "INDETERMINATE":
            counts.indeterminate++;
            break;
          case "CONFIGURATION_ERROR":
            counts.configurationError++;
            this.logger.warn("Connector credential heartbeat: configuration problem", {
              slug: inst.slug,
              installationId: inst.id,
              tenantKey: inst.tenantKey,
              reason: record.reason,
            });
            break;
        }
      }
    } finally {
      this.running = false;
      this.logger.info("Connector credential heartbeat completed.", counts);
    }
  }

  // Prefer the tri-state verifier (valid / invalid / unavailable). A connector without it
  // falls back to the legacy boolean, whose `false` is only trusted as a rejection for an
  // audited connector (see credential-validation.ts).
  private async validate(inst: InstallationRow): Promise<ValidationRecord> {
    const connector = this.registry.getConnector(inst.slug);
    const ctx = this.buildContext(inst);
    if (connector.validateStoredCredentialsDetailed) {
      const result = await connector.validateStoredCredentialsDetailed(ctx);
      if (result.outcome !== "not_supported") {
        return classifyDetailedResult(result);
      }
    }
    return classifyLegacyBoolean(inst.slug, await connector.validateCredentials(ctx));
  }

  private async loadActiveInstallations(): Promise<InstallationRow[]> {
    const db = this.prismaDirect.getClient();
    // SEC-DB-RLS-001: this used to be ONE read through the context-free client, which under row level security sees no tenant's
    // installations, so the heartbeat would have validated nothing while reporting a clean tick. It now reads per tenant
    // (forEachTenant: one transaction per tenant, tenant context set inside it) and every query ALSO filters by the tenant it is
    // given, so it is correct whether or not the role bypasses RLS. Each tenant contributes at most one batch; the results are
    // merged in the same order the single query used (never-attempted first, then longest-unattempted, then id) and cut to one
    // batch, so every installation is still visited once before any is visited twice. A tenant that cannot be read is logged as
    // an error by code and the readable tenants are still checked this tick.
    const found: Array<{ id: string; tenantKey: string; connectorId: string; lastValidationAttemptAt: Date | null }> = [];
    const discovery = await forEachTenant(db, async (tx, tenantKey) => {
      const tenantRows = await tx.connectorInstallation.findMany({
        where: { tenantKey, status: { in: ["ACTIVE", "CREDENTIAL_EXPIRED"] } },
        take: HEARTBEAT_BATCH_SIZE,
        select: { id: true, tenantKey: true, connectorId: true, lastValidationAttemptAt: true },
        // Never-attempted installations first, then the longest-unattempted, then id: a stable
        // order in which every installation is visited once before any is visited twice.
        orderBy: [{ lastValidationAttemptAt: { sort: "asc", nulls: "first" } }, { id: "asc" }],
      });
      // A row of another tenant means the filter above was bypassed: count it as a failure, never act on it.
      const own = tenantRows.filter((row: { tenantKey: string }) => row.tenantKey === tenantKey);
      found.push(...own);
      return { examinedCount: tenantRows.length, changedCount: 0, failedCount: tenantRows.length - own.length };
    });
    if (discovery.tenantsFailed > 0) {
      this.logger.error("Connector credential heartbeat could not read some tenants; their installations were NOT checked this tick.", {
        tenantsFailed: discovery.tenantsFailed,
        tenantsEvaluated: discovery.tenantsEvaluated,
        failures: discovery.results
          .filter((result) => result.status === "failed")
          .map((result) => ({ tenantKey: result.tenantKey, errorCode: result.errorCode ?? "UNKNOWN" })),
      });
    }
    const attemptTime = (row: { lastValidationAttemptAt: Date | null }) => (row.lastValidationAttemptAt ? new Date(row.lastValidationAttemptAt).getTime() : null);
    const rows = found
      .sort((x, y) => {
        const xa = attemptTime(x);
        const ya = attemptTime(y);
        if (xa !== ya) {
          if (xa === null) return -1;
          if (ya === null) return 1;
          return xa - ya;
        }
        return x.id < y.id ? -1 : x.id > y.id ? 1 : 0;
      })
      .slice(0, HEARTBEAT_BATCH_SIZE);
    if (rows.length === 0) return [];

    const connectorIds = [...new Set(rows.map((r: { connectorId: string }) => r.connectorId))];
    const definitions = await db.connectorDefinition.findMany({
      where: { id: { in: connectorIds } },
      select: { id: true, slug: true },
    });
    const slugById = new Map(definitions.map((d: { id: string; slug: string }) => [d.id, d.slug]));

    return rows
      .filter((r: { connectorId: string }) => slugById.has(r.connectorId))
      .map((r: { id: string; tenantKey: string; connectorId: string }) => ({
        id: r.id,
        tenantKey: r.tenantKey,
        connectorId: r.connectorId,
        slug: slugById.get(r.connectorId)!,
      }));
  }

  private buildContext(inst: InstallationRow): ConnectorContext {
    const ctx: ConnectorContext = {
      tenantId: inst.tenantKey,
      installationId: inst.id,
      connectorId: inst.connectorId,
      getAccessToken: async () => {
        const connector = this.registry.getConnector(inst.slug);
        return this.credentialService.getOrRefreshAccessToken(
          inst.tenantKey,
          inst.id,
          inst.slug,
          async () => {
            if (!connector.refreshAccessToken) {
              throw new Error(`Connector '${inst.slug}' does not implement refreshAccessToken.`);
            }
            return connector.refreshAccessToken(ctx);
          },
        );
      },
      fetch: (url, init) => this.httpClient.fetch(inst.slug, inst.id, url, init),
    };
    return ctx;
  }

  // Records the outcome. lastValidatedAt moves only on VALID. Only INVALID changes the
  // installation status (to CREDENTIAL_EXPIRED); INDETERMINATE and CONFIGURATION_ERROR keep
  // whatever status the installation had. VALID promotes CREDENTIAL_EXPIRED back to ACTIVE
  // and leaves ACTIVE as it is. updatedAt moves only on a status transition, as before.
  private async recordOutcome(inst: InstallationRow, record: ValidationRecord): Promise<void> {
    // SEC-DB-RLS-001: this wrote through the context-free client, whose updateMany matches no row under row level security, so a
    // recorded outcome would have been silently lost. It now writes inside the installation's own tenant transaction (both
    // writes together). A failed write throws so the caller counts it, exactly as a failed query did before.
    const outcome = await forEachTenant(
      this.prismaDirect.getClient(),
      async (tx) => {
        await tx.connectorInstallation.updateMany({
          where: { id: inst.id, tenantKey: inst.tenantKey },
          data: validationColumns(record, new Date()),
        });
        if (record.outcome === "INVALID") {
          await tx.connectorInstallation.updateMany({
            where: { id: inst.id, tenantKey: inst.tenantKey },
            data: { status: "CREDENTIAL_EXPIRED", updatedAt: new Date() },
          });
        } else if (record.outcome === "VALID") {
          await tx.connectorInstallation.updateMany({
            where: { id: inst.id, tenantKey: inst.tenantKey, status: "CREDENTIAL_EXPIRED" },
            data: { status: "ACTIVE", updatedAt: new Date() },
          });
        }
        return { examinedCount: 1, changedCount: 1 };
      },
      { tenantKeys: [inst.tenantKey] },
    );
    if (outcome.tenantsFailed > 0) {
      throw new Error(`validation outcome not recorded (${outcome.results[0]?.errorCode ?? "UNKNOWN"})`);
    }
  }
}
