import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { getTenantKeyFromContext } from "../common/tenant/tenant-context";
import { normalizeTenantKey } from "../common/tenant/tenant.constants";
import { createTenantScopeExtension } from "./extensions/tenant-scope";
import {
  parseConnectionLimit,
  withApplicationName,
  withConnectionLimit,
  withTenantDatabaseUrl,
} from "./prisma-url";

type DbPoolRow = {
  active: bigint | number;
  idle: bigint | number;
  waiting: bigint | number;
};

export interface DbPoolStats {
  active: number;
  idle: number;
  waiting: number;
  applicationName: string;
}

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly clients = new Map<string, PrismaClient>();
  private readonly CLIENT_LIMIT = 50;
  private readonly poolApplicationName = String(process.env.DB_POOL_APP_NAME ?? "vexa-pim-api").trim() || "vexa-pim-api";
  private readonly connectionLimit = parseConnectionLimit(process.env.DB_POOL_CONNECTION_LIMIT);
  private readonly logger = new Logger(PrismaService.name);

  private getBaseDatabaseUrl(): string {
    const databaseUrl = String(process.env.DATABASE_URL_POOLED ?? process.env.DATABASE_URL ?? "").trim();
    if (!databaseUrl) {
      throw new Error("DATABASE_URL_POOLED is not configured.");
    }
    return withApplicationName(databaseUrl, this.poolApplicationName);
  }

  private createClient(tenantKey: string): PrismaClient {
    const datasourceUrl = withConnectionLimit(
      withTenantDatabaseUrl(this.getBaseDatabaseUrl(), tenantKey),
      this.connectionLimit,
    );
    const baseClient = new PrismaClient({
      datasources: {
        db: {
          url: datasourceUrl,
        },
      },
    });
    return baseClient.$extends(createTenantScopeExtension(tenantKey)) as unknown as PrismaClient;
  }

  private getClient(tenantKey: string): PrismaClient {
    const normalizedTenant = normalizeTenantKey(tenantKey);
    const existing = this.clients.get(normalizedTenant);
    if (existing) {
      return existing;
    }
    if (this.clients.size >= this.CLIENT_LIMIT) {
      // FIFO eviction: Map iteration order is insertion order.
      const [oldestKey, oldestClient] = this.clients.entries().next().value as [string, PrismaClient];
      this.clients.delete(oldestKey);
      void oldestClient.$disconnect();
    }
    const created = this.createClient(normalizedTenant);
    this.clients.set(normalizedTenant, created);
    return created;
  }

  tenant(tenantKey?: string): PrismaClient {
    const effectiveTenant = normalizeTenantKey(tenantKey ?? getTenantKeyFromContext());
    return this.getClient(effectiveTenant);
  }

  async getPoolStats(): Promise<DbPoolStats> {
    const rows = await this.tenant()
      // RLS-BYPASS: pg_stat_activity is a Postgres-internal diagnostic view, not tenant
      // data — this reports connection-pool health for the whole process, filtered only
      // by this process's own application_name.
      .$queryRaw<DbPoolRow[]>`SELECT
        COUNT(*) FILTER (WHERE state = 'active') AS active,
        COUNT(*) FILTER (WHERE state = 'idle') AS idle,
        COUNT(*) FILTER (WHERE wait_event_type IS NOT NULL AND state <> 'idle') AS waiting
      FROM pg_stat_activity
      WHERE application_name = ${this.poolApplicationName}
      AND pid <> pg_backend_pid()`;

    const row = rows[0] ?? { active: 0, idle: 0, waiting: 0 };
    return {
      active: Number(row.active ?? 0),
      idle: Number(row.idle ?? 0),
      waiting: Number(row.waiting ?? 0),
      applicationName: this.poolApplicationName,
    };
  }

  async onModuleInit() {
    // Make the effective pool size visible in the boot logs: connection_limit applies PER TENANT CLIENT (each
    // tenant has its own pool), and when the variable is unset the default of 5 is used. A tenant with more
    // than that many concurrent queries waits and then fails with P2024 after the pool timeout.
    this.logger.log(
      `DB pool: connection_limit=${this.connectionLimit} per tenant client (${
        String(process.env.DB_POOL_CONNECTION_LIMIT ?? "").trim() ? "DB_POOL_CONNECTION_LIMIT" : "default"
      }), tenant client cap=${this.CLIENT_LIMIT}`,
    );
    if (String(process.env.AUTH_MODE ?? "").trim().toLowerCase() !== "db") {
      return;
    }
    await this.tenant().$connect();
  }

  async onModuleDestroy() {
    const clients = Array.from(this.clients.values());
    this.clients.clear();
    await Promise.all(clients.map((client) => client.$disconnect()));
  }
}
