import { Injectable, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { getTenantKeyFromContext } from "../common/tenant/tenant-context";
import { normalizeTenantKey } from "../common/tenant/tenant.constants";
import { createTenantScopeExtension } from "./extensions/tenant-scope";

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

function withTenantDatabaseUrl(databaseUrl: string, tenantKey: string): string {
  const encoded = encodeURIComponent(`-c app.tenant_key=${tenantKey}`);
  if (databaseUrl.includes("options=")) {
    return databaseUrl.replace(/([?&])options=[^&]*/, `$1options=${encoded}`);
  }
  if (databaseUrl.includes("?")) {
    return `${databaseUrl}&options=${encoded}`;
  }
  return `${databaseUrl}?options=${encoded}`;
}

@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  private readonly clients = new Map<string, PrismaClient>();
  private readonly CLIENT_LIMIT = 50;
  private readonly poolApplicationName = String(process.env.DB_POOL_APP_NAME ?? "vexa-pim-api").trim() || "vexa-pim-api";

  private getBaseDatabaseUrl(): string {
    const databaseUrl = String(process.env.DATABASE_URL_POOLED ?? process.env.DATABASE_URL ?? "").trim();
    if (!databaseUrl) {
      throw new Error("DATABASE_URL_POOLED is not configured.");
    }
    return this.withApplicationName(databaseUrl, this.poolApplicationName);
  }

  private withApplicationName(databaseUrl: string, appName: string): string {
    if (databaseUrl.includes("application_name=")) {
      return databaseUrl;
    }
    const encodedName = encodeURIComponent(appName);
    if (databaseUrl.includes("?")) {
      return `${databaseUrl}&application_name=${encodedName}`;
    }
    return `${databaseUrl}?application_name=${encodedName}`;
  }

  private createClient(tenantKey: string): PrismaClient {
    const datasourceUrl = withTenantDatabaseUrl(this.getBaseDatabaseUrl(), tenantKey);
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
