import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import { normalizeApiClientScopes, type ApiClientScope } from "../common/rbac/api-client-policy.decorator";
import { normalizeAppRole } from "../common/rbac/role-utils";
import { type AppRole } from "../common/rbac/roles";
import { normalizeTenantKey } from "../common/tenant/tenant.constants";
import { PrismaService } from "../prisma/prisma.service";
import {
  apiKeySecretMatches,
  buildApiKeyPrefix,
  buildPlainTextApiKey,
  generateApiKeySecret,
  hashApiKeySecret,
  parsePlainTextApiKey,
} from "./api-key-auth";
import { CreateApiKeyDto } from "./dto/create-api-key.dto";

type ApiKeyRow = {
  id: string;
  tenantKey: string;
  label: string;
  role: string;
  scopes: string[];
  keyPrefix: string;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ApiAccessKeySummary = {
  id: string;
  label: string;
  role: AppRole;
  scopes: ApiClientScope[];
  keyPrefix: string;
  isActive: boolean;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreatedApiAccessKey = ApiAccessKeySummary & {
  plainTextKey: string;
};

export type ResolvedApiKeyIdentity = {
  keyId: string;
  actorId: string;
  tenantId: string;
  role: AppRole;
  label: string;
  scopes: ApiClientScope[];
};

function isRowActive(row: Pick<ApiKeyRow, "revokedAt" | "expiresAt">, now = new Date()): boolean {
  if (row.revokedAt) {
    return false;
  }
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) {
    return false;
  }
  return true;
}

@Injectable()
export class ApiKeysService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async listKeys(tenantIdInput: string): Promise<ApiAccessKeySummary[]> {
    const tenantId = normalizeTenantKey(tenantIdInput);
    const rows = await this.prisma.tenant(tenantId).apiAccessKey.findMany({
      where: {
        tenantKey: tenantId,
      },
      orderBy: [
        { createdAt: "desc" },
        { id: "desc" },
      ],
      take: 200, // defensive cap — tenants don't create hundreds of API keys
      select: {
        id: true,
        tenantKey: true,
        label: true,
        role: true,
        scopes: true,
        keyPrefix: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        createdBy: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return rows.map((row) => this.mapRow(row));
  }

  async createKey(
    tenantIdInput: string,
    actorId: string,
    actorRole: AppRole,
    dto: CreateApiKeyDto,
  ): Promise<CreatedApiAccessKey> {
    const tenantId = normalizeTenantKey(tenantIdInput);
    const label = String(dto.label ?? "").trim();
    if (!label) {
      throw new BadRequestException({ error: "API_KEY_LABEL_REQUIRED" });
    }

    const role = normalizeAppRole(dto.role) ?? "viewer";
    if (role === "admin") {
      throw new ForbiddenException({ error: "API_KEY_ADMIN_ROLE_FORBIDDEN" });
    }
    const scopes = normalizeApiClientScopes(dto.scopes ?? []);

    const expiresAt = this.resolveExpiry(dto.expiresAt);
    const id = randomUUID();
    const secret = generateApiKeySecret();
    const plainTextKey = buildPlainTextApiKey(id, secret);

    const created = await this.prisma.tenant(tenantId).apiAccessKey.create({
      data: {
        id,
        tenantKey: tenantId,
        label,
        role,
        scopes,
        keyPrefix: buildApiKeyPrefix(id),
        secretHash: hashApiKeySecret(secret),
        expiresAt,
        createdBy: actorId,
      },
      select: {
        id: true,
        tenantKey: true,
        label: true,
        role: true,
        scopes: true,
        keyPrefix: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        createdBy: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await this.auditService.record({
      actorId,
      actorRole,
      action: "api_key.created",
      resource: "ApiAccessKey",
      resourceId: created.id,
      metadata: {
        label: created.label,
        keyPrefix: created.keyPrefix,
        role,
        scopes,
        expiresAt: created.expiresAt?.toISOString() ?? null,
      },
    });

    return {
      ...this.mapRow(created),
      plainTextKey,
    };
  }

  async revokeKey(
    tenantIdInput: string,
    actorId: string,
    actorRole: AppRole,
    keyIdInput: string,
  ): Promise<ApiAccessKeySummary> {
    const tenantId = normalizeTenantKey(tenantIdInput);
    const keyId = String(keyIdInput ?? "").trim();
    if (!keyId) {
      throw new BadRequestException({ error: "API_KEY_ID_REQUIRED" });
    }

    const existing = await this.prisma.tenant(tenantId).apiAccessKey.findFirst({
      where: {
        tenantKey: tenantId,
        id: keyId,
      },
      select: {
        id: true,
        tenantKey: true,
        label: true,
        role: true,
        scopes: true,
        keyPrefix: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        createdBy: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!existing) {
      throw new NotFoundException({ error: "API_KEY_NOT_FOUND" });
    }

    const revoked = await this.prisma.tenant(tenantId).apiAccessKey.update({
      where: {
        id: existing.id,
      },
      data: {
        revokedAt: new Date(),
      },
      select: {
        id: true,
        tenantKey: true,
        label: true,
        role: true,
        scopes: true,
        keyPrefix: true,
        lastUsedAt: true,
        expiresAt: true,
        revokedAt: true,
        createdBy: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    await this.auditService.record({
      actorId,
      actorRole,
      action: "api_key.revoked",
      resource: "ApiAccessKey",
      resourceId: revoked.id,
      metadata: {
        label: revoked.label,
        keyPrefix: revoked.keyPrefix,
      },
    });

    return this.mapRow(revoked);
  }

  async resolveApiKey(rawKeyInput: string): Promise<ResolvedApiKeyIdentity | null> {
    const parsed = parsePlainTextApiKey(rawKeyInput);
    if (!parsed) {
      return null;
    }

    const row = await this.prisma.tenant().apiAccessKey.findUnique({
      where: {
        id: parsed.id,
      },
      select: {
        id: true,
        tenantKey: true,
        label: true,
        role: true,
        scopes: true,
        secretHash: true,
        expiresAt: true,
        revokedAt: true,
      },
    });
    if (!row || !isRowActive(row)) {
      return null;
    }
    if (!apiKeySecretMatches(row.secretHash, parsed.secret)) {
      return null;
    }

    return {
      keyId: row.id,
      actorId: `api_key:${row.id}`,
      tenantId: normalizeTenantKey(row.tenantKey),
      role: normalizeAppRole(row.role) ?? "viewer",
      label: row.label,
      scopes: normalizeApiClientScopes(row.scopes),
    };
  }

  async touchLastUsed(keyIdInput: string): Promise<void> {
    const keyId = String(keyIdInput ?? "").trim();
    if (!keyId) {
      return;
    }
    // Fired with `void` on every API-key request: nothing here (including prisma.tenant() itself) may reject.
    try {
      await this.prisma.tenant().apiAccessKey.update({
        where: {
          id: keyId,
        },
        data: {
          lastUsedAt: new Date(),
        },
      });
    } catch {
      // last-used bookkeeping is best effort
    }
  }

  private resolveExpiry(value: string | undefined): Date | null {
    const normalized = String(value ?? "").trim();
    if (!normalized) {
      return null;
    }
    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException({ error: "API_KEY_EXPIRY_INVALID" });
    }
    if (parsed.getTime() <= Date.now()) {
      throw new BadRequestException({ error: "API_KEY_EXPIRY_IN_PAST" });
    }
    return parsed;
  }

  private mapRow(row: ApiKeyRow): ApiAccessKeySummary {
    return {
      id: row.id,
      label: row.label,
      role: normalizeAppRole(row.role) ?? "viewer",
      scopes: normalizeApiClientScopes(row.scopes),
      keyPrefix: row.keyPrefix,
      isActive: isRowActive(row),
      lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
