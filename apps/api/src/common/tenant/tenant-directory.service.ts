import { Injectable, Logger } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
import { PrismaService } from "../../prisma/prisma.service";
import {
  DEFAULT_TENANT_KEY,
  DEFAULT_WORKSPACE_SLUG,
  isValidWorkspaceSlug,
  normalizeTenantKey,
  normalizeWorkspaceSlug,
} from "./tenant.constants";

export interface ResolvedWorkspaceDirectoryEntry {
  tenantId: string;
  workspaceSlug: string;
  displayName: string;
}

export interface ProvisionWorkspaceInput {
  tenantKey: string;
  workspaceSlug: string;
  displayName: string;
  initialAdminUserId: string;
}

export interface ProvisionWorkspaceWithPasswordHashInput extends ProvisionWorkspaceInput {
  initialAdminPasswordHash: string;
}

interface LocalWorkspaceDirectoryEntry {
  tenantId: string;
  displayName: string;
}

@Injectable()
export class TenantDirectoryService {
  private readonly logger = new Logger(TenantDirectoryService.name);
  private readonly localDirectory = this.loadLocalWorkspaceDirectory();

  constructor(private readonly prisma: PrismaService) {}

  async resolveWorkspaceSlug(workspaceSlugInput: string): Promise<ResolvedWorkspaceDirectoryEntry | null> {
    const workspaceSlug = normalizeWorkspaceSlug(workspaceSlugInput);
    if (!isValidWorkspaceSlug(workspaceSlug)) {
      return null;
    }

    if (!this.isDbAuthMode()) {
      const local = this.localDirectory.get(workspaceSlug);
      if (!local) {
        return null;
      }
      return {
        tenantId: local.tenantId,
        workspaceSlug,
        displayName: local.displayName,
      };
    }

    const row = await this.prisma.tenant(DEFAULT_TENANT_KEY).workspaceDirectory.findUnique({
      where: {
        workspaceSlug,
      },
    });
    if (!row || !row.isActive) {
      return null;
    }
    return {
      tenantId: normalizeTenantKey(row.tenantKey),
      workspaceSlug: normalizeWorkspaceSlug(row.workspaceSlug),
      displayName: String(row.displayName ?? row.workspaceSlug).trim() || row.workspaceSlug,
    };
  }

  async resolveTenantAlias(tenantKeyInput: string): Promise<ResolvedWorkspaceDirectoryEntry | null> {
    const tenantId = normalizeTenantKey(tenantKeyInput);
    if (!tenantId) {
      return null;
    }

    if (!this.isDbAuthMode()) {
      return {
        tenantId,
        workspaceSlug: normalizeWorkspaceSlug(tenantId),
        displayName: tenantId,
      };
    }

    const row = await this.prisma.tenant(DEFAULT_TENANT_KEY).workspaceDirectory.findUnique({
      where: {
        tenantKey: tenantId,
      },
    });
    if (!row || !row.isActive) {
      return null;
    }
    return {
      tenantId: normalizeTenantKey(row.tenantKey),
      workspaceSlug: normalizeWorkspaceSlug(row.workspaceSlug),
      displayName: String(row.displayName ?? row.workspaceSlug).trim() || row.workspaceSlug,
    };
  }

  async provisionWorkspace(input: ProvisionWorkspaceInput): Promise<ResolvedWorkspaceDirectoryEntry> {
    return this.provisionWorkspaceInternal({
      ...input,
      initialAdminPasswordHash: await this.resolveInitialPasswordHash(),
      overrideExistingPasswordHash: false,
    });
  }

  async provisionWorkspaceWithPasswordHash(
    input: ProvisionWorkspaceWithPasswordHashInput,
  ): Promise<ResolvedWorkspaceDirectoryEntry> {
    return this.provisionWorkspaceInternal({
      ...input,
      initialAdminPasswordHash: input.initialAdminPasswordHash,
      overrideExistingPasswordHash: true,
    });
  }

  private async provisionWorkspaceInternal(
    input: ProvisionWorkspaceInput & {
      initialAdminPasswordHash: string | null;
      overrideExistingPasswordHash: boolean;
    },
  ): Promise<ResolvedWorkspaceDirectoryEntry> {
    const tenantKey = normalizeTenantKey(input.tenantKey);
    const workspaceSlug = normalizeWorkspaceSlug(input.workspaceSlug);
    const displayName = String(input.displayName ?? "").trim();
    const initialAdminUserId = String(input.initialAdminUserId ?? "").trim().toLowerCase();

    if (!isValidWorkspaceSlug(workspaceSlug)) {
      throw new Error("WORKSPACE_SLUG_INVALID");
    }
    if (!displayName) {
      throw new Error("DISPLAY_NAME_REQUIRED");
    }
    if (!initialAdminUserId) {
      throw new Error("INITIAL_ADMIN_USER_REQUIRED");
    }

    const prisma = this.prisma.tenant(DEFAULT_TENANT_KEY);
    const existingBySlug = await prisma.workspaceDirectory.findUnique({
      where: { workspaceSlug },
    });
    if (existingBySlug && normalizeTenantKey(existingBySlug.tenantKey) !== tenantKey) {
      throw new Error("WORKSPACE_SLUG_ALREADY_ASSIGNED");
    }

    const existingByTenant = await prisma.workspaceDirectory.findUnique({
      where: { tenantKey },
    });
    if (existingByTenant && normalizeWorkspaceSlug(existingByTenant.workspaceSlug) !== workspaceSlug) {
      throw new Error("TENANT_WORKSPACE_ALREADY_ASSIGNED");
    }

    const existingIdentity = await prisma.authIdentity.findUnique({
      where: { userId: initialAdminUserId },
      select: {
        id: true,
        tenantKey: true,
      },
    });
    if (existingIdentity && normalizeTenantKey(existingIdentity.tenantKey) !== tenantKey) {
      throw new Error("INITIAL_ADMIN_USER_ALREADY_ASSIGNED");
    }

    const workspace = existingBySlug
      ? await prisma.workspaceDirectory.update({
          where: { workspaceSlug },
          data: {
            displayName,
            isActive: true,
          },
        })
      : await prisma.workspaceDirectory.create({
          data: {
            tenantKey,
            workspaceSlug,
            displayName,
            isActive: true,
          },
        });

    if (existingIdentity) {
      await prisma.authIdentity.update({
        where: { userId: initialAdminUserId },
        data: {
          role: "admin",
          isActive: true,
          ...(input.overrideExistingPasswordHash && input.initialAdminPasswordHash
            ? { passwordHash: input.initialAdminPasswordHash }
            : {}),
        },
      });
    } else {
      await prisma.authIdentity.create({
        data: {
          tenantKey,
          userId: initialAdminUserId,
          role: "admin",
          isActive: true,
          passwordHash: input.initialAdminPasswordHash,
        },
      });
    }

    return {
      tenantId: normalizeTenantKey(workspace.tenantKey),
      workspaceSlug: normalizeWorkspaceSlug(workspace.workspaceSlug),
      displayName: workspace.displayName,
    };
  }

  private async resolveInitialPasswordHash(): Promise<string | null> {
    const configuredPassword = String(process.env.PIM_AUTH_PASSWORD ?? "").trim();
    const appEnv = String(process.env.APP_ENV ?? process.env.NODE_ENV ?? "development").trim().toLowerCase();
    const allowLocalDefault = appEnv === "development" || appEnv === "local" || appEnv === "test";
    const sharedPassword = configuredPassword || (allowLocalDefault ? "vexa-pim-demo-password" : "");
    if (!sharedPassword) {
      return null;
    }
    return bcrypt.hash(sharedPassword, 12);
  }

  private isDbAuthMode(): boolean {
    return String(process.env.AUTH_MODE ?? "").trim().toLowerCase() === "db";
  }

  private loadLocalWorkspaceDirectory(): Map<string, LocalWorkspaceDirectoryEntry> {
    const directory = new Map<string, LocalWorkspaceDirectoryEntry>();

    const rawWorkspaceMap = String(process.env.PIM_AUTH_WORKSPACES_JSON ?? "").trim();
    if (rawWorkspaceMap) {
      try {
        const parsed = JSON.parse(rawWorkspaceMap) as Record<string, unknown>;
        for (const [slugRaw, value] of Object.entries(parsed)) {
          const workspaceSlug = normalizeWorkspaceSlug(slugRaw);
          if (!isValidWorkspaceSlug(workspaceSlug)) {
            continue;
          }
          if (typeof value === "string") {
            directory.set(workspaceSlug, {
              tenantId: normalizeTenantKey(value),
              displayName: workspaceSlug,
            });
            continue;
          }
          if (!value || typeof value !== "object" || Array.isArray(value)) {
            continue;
          }
          const candidate = value as Record<string, unknown>;
          directory.set(workspaceSlug, {
            tenantId: normalizeTenantKey(candidate.tenantId ?? process.env.PIM_DEFAULT_TENANT_KEY),
            displayName: String(candidate.displayName ?? workspaceSlug).trim() || workspaceSlug,
          });
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error ?? "unknown error");
        this.logger.warn(`PIM_AUTH_WORKSPACES_JSON parse failed. Falling back to derived workspace directory: ${message}`);
      }
    }

    const rawIdentityDirectory = String(process.env.PIM_AUTH_IDENTITIES_JSON ?? "").trim();
    if (rawIdentityDirectory) {
      try {
        const parsed = JSON.parse(rawIdentityDirectory) as Record<string, unknown>;
        for (const value of Object.values(parsed)) {
          if (!value || typeof value !== "object" || Array.isArray(value)) {
            continue;
          }
          const candidate = value as Record<string, unknown>;
          const tenantId = normalizeTenantKey(candidate.tenantId ?? process.env.PIM_DEFAULT_TENANT_KEY);
          const slugSource = candidate.workspaceSlug ?? tenantId;
          const workspaceSlug = normalizeWorkspaceSlug(slugSource);
          if (!isValidWorkspaceSlug(workspaceSlug) || directory.has(workspaceSlug)) {
            continue;
          }
          directory.set(workspaceSlug, {
            tenantId,
            displayName: String(candidate.displayName ?? workspaceSlug).trim() || workspaceSlug,
          });
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error ?? "unknown error");
        this.logger.warn(`PIM_AUTH_IDENTITIES_JSON parse failed while deriving local workspace directory: ${message}`);
      }
    }

    if (directory.size === 0) {
      directory.set(DEFAULT_WORKSPACE_SLUG, {
        tenantId: normalizeTenantKey(process.env.PIM_DEFAULT_TENANT_KEY),
        displayName: DEFAULT_WORKSPACE_SLUG,
      });
    }

    const defaultTenantSlug = normalizeWorkspaceSlug(process.env.PIM_DEFAULT_TENANT_KEY);
    if (isValidWorkspaceSlug(defaultTenantSlug) && !directory.has(defaultTenantSlug)) {
      directory.set(defaultTenantSlug, {
        tenantId: normalizeTenantKey(process.env.PIM_DEFAULT_TENANT_KEY),
        displayName: defaultTenantSlug,
      });
    }

    return directory;
  }
}
