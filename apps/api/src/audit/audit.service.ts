import { Injectable, OnModuleInit } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../prisma/prisma.service";

export interface AuditLogRecordInput {
  actorId: string;
  actorRole: string;
  action: string;
  resource: string;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService implements OnModuleInit {
  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.ensureTable();
  }

  async ensureTable() {
    await this.prisma.$executeRawUnsafe(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id TEXT PRIMARY KEY,
        actor_id TEXT NOT NULL,
        actor_role TEXT NOT NULL,
        action TEXT NOT NULL,
        resource TEXT NOT NULL,
        resource_id TEXT NULL,
        metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC);
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_created_at ON audit_logs (actor_id, created_at DESC);
    `);
    await this.prisma.$executeRawUnsafe(`
      CREATE INDEX IF NOT EXISTS idx_audit_logs_resource_created_at ON audit_logs (resource, created_at DESC);
    `);
  }

  async record(input: AuditLogRecordInput) {
    const metadata = JSON.stringify(input.metadata ?? {});
    try {
      await this.prisma.$executeRawUnsafe(
        `
        INSERT INTO audit_logs (
          id,
          actor_id,
          actor_role,
          action,
          resource,
          resource_id,
          metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
        `,
        randomUUID(),
        input.actorId,
        input.actorRole,
        input.action,
        input.resource,
        input.resourceId ?? null,
        metadata,
      );
    } catch {
      // Audit logging should not break the primary request path.
    }
  }

  async list(limit = 50, actorId?: string) {
    const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 200) : 50;
    if (actorId) {
      return this.prisma.$queryRawUnsafe(
        `
        SELECT
          id,
          actor_id AS "actorId",
          actor_role AS "actorRole",
          action,
          resource,
          resource_id AS "resourceId",
          metadata,
          created_at AS "createdAt"
        FROM audit_logs
        WHERE actor_id = $1
        ORDER BY created_at DESC
        LIMIT $2
        `,
        actorId,
        safeLimit,
      );
    }

    return this.prisma.$queryRawUnsafe(
      `
      SELECT
        id,
        actor_id AS "actorId",
        actor_role AS "actorRole",
        action,
        resource,
        resource_id AS "resourceId",
        metadata,
        created_at AS "createdAt"
      FROM audit_logs
      ORDER BY created_at DESC
      LIMIT $1
      `,
      safeLimit,
    );
  }
}
