import { Injectable, OnApplicationBootstrap, OnApplicationShutdown } from "@nestjs/common";
import { resolveCurrentCredentialKeyVersion } from "../connector-installer/credential-encryption.util";
import { LoggerService } from "../common/logging/logger.service";
import { runWithAdvisoryLock } from "../common/scheduling/advisory-lock";
import { PrismaDirectService } from "../prisma/prisma-direct.service";
import { ConnectorRegistry } from "./connector.registry";
import { ConnectorCredentialService } from "./connector-credential.service";
import { ConnectorHttpClient } from "./connector-http-client.service";
import { ConnectorContext } from "./connector.interface";

const HEARTBEAT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours
const INITIAL_DELAY_MS = 30 * 1000;                // 30 seconds after boot
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
    }, INITIAL_DELAY_MS);
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
    const db = this.prismaDirect.getClient();

    // Check if any credentials are on a stale key version
    const staleCount = await db.connectorCredential.count({
      where: { keyVersion: { not: `v${currentVersion}` } },
    });

    if (staleCount === 0) {
      return;
    }

    this.logger.info("connector.credential.rotation_triggered", {
      staleCount,
      currentVersion: `v${currentVersion}`,
    });

    try {
      const result = await this.credentialService.rotateAllCredentials();
      this.logger.info("connector.credential.rotation_result", result);
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
    let checked = 0;
    let expired = 0;
    let errors = 0;

    try {
      const installations = await this.loadActiveInstallations();
      for (const inst of installations) {
        try {
          const connector = this.registry.getConnector(inst.slug);
          const ctx = this.buildContext(inst);
          const valid = await connector.validateCredentials(ctx);

          if (!valid) {
            await this.markExpired(inst);
            expired++;
            this.logger.warn("Connector credential heartbeat: credentials expired", {
              slug: inst.slug,
              installationId: inst.id,
              tenantKey: inst.tenantKey,
            });
          } else {
            await this.markValidated(inst);
          }
          checked++;
        } catch (err) {
          errors++;
          this.logger.warn("Connector credential heartbeat: error checking installation", {
            installationId: inst.id,
            tenantKey: inst.tenantKey,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    } finally {
      this.running = false;
      this.logger.info("Connector credential heartbeat completed.", { checked, expired, errors });
    }
  }

  private async loadActiveInstallations(): Promise<InstallationRow[]> {
    const db = this.prismaDirect.getClient();
    const rows = await db.connectorInstallation.findMany({
      where: { status: { in: ["ACTIVE", "CREDENTIAL_EXPIRED"] } },
      take: HEARTBEAT_BATCH_SIZE,
      select: { id: true, tenantKey: true, connectorId: true },
      orderBy: { updatedAt: "asc" },
    });

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

  private async markExpired(inst: InstallationRow): Promise<void> {
    const db = this.prismaDirect.getClient();
    await db.connectorInstallation.updateMany({
      where: { id: inst.id, tenantKey: inst.tenantKey },
      data: { status: "CREDENTIAL_EXPIRED", updatedAt: new Date() },
    });
  }

  private async markValidated(inst: InstallationRow): Promise<void> {
    const db = this.prismaDirect.getClient();
    // Only promote CREDENTIAL_EXPIRED → ACTIVE when validation passes again.
    // Leave ACTIVE as-is to avoid unnecessary writes.
    await db.connectorInstallation.updateMany({
      where: { id: inst.id, tenantKey: inst.tenantKey, status: "CREDENTIAL_EXPIRED" },
      data: { status: "ACTIVE", updatedAt: new Date() },
    });
  }
}
