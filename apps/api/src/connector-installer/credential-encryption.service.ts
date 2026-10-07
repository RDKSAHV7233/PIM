import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { LoggerService } from "../common/logging/logger.service";
import { forEachTenant, type TenantIterationOverall, type TenantIterationSummary } from "../common/tenant/tenant-iteration";
import { PrismaDirectService } from "../prisma/prisma-direct.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  buildEncryptedCredential,
  decryptCredentialValue,
  formatCredentialKeyVersion,
  loadCredentialEncryptionKeys,
  parseCredentialKeyVersion,
  resolveCurrentCredentialKeyVersion,
} from "./credential-encryption.util";

const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 1_000;

type CredentialRow = {
  id: string;
  encryptedValue: string;
  keyVersion: string;
};

export interface RotateCredentialKeyOptions {
  fromVersion: number;
  toVersion: number;
  batchSize?: number;
  dryRun?: boolean;
}

export interface RotateCredentialKeyResult {
  rotated: number;
  failed: number;
  errors: string[];
  /** SUCCESS only when every tenant and every credential succeeded; otherwise PARTIAL_FAILURE or FAILED. */
  status: TenantIterationOverall;
  tenants: TenantIterationSummary;
}

export interface StoreCredentialInput {
  tenantKey: string;
  installationId: string;
  credentialType: string;
  plainValue: string;
  status?: string;
  scope?: string | null;
  expiresAt?: Date | null;
  metadata?: Record<string, unknown> | null;
}

/**
 * Health-metadata reset for a storeCredential() call. Additive/opt-in — omitting
 * this param entirely (every existing call site) behaves byte-identical to
 * before this parameter existed. Only pass it when this specific field's value
 * was actually exercised by a live check (see the per-connector "which fields
 * does the candidate call actually touch" table in updateCredentials()) — never
 * a blanket "the whole set was just verified" claim when only some of it was.
 */
export interface StoreCredentialHealth {
  failureReason?: string | null;
  lastValidatedAt?: Date | null;
}

@Injectable()
export class ConnectorCredentialEncryptionService {
  private readonly keys = loadCredentialEncryptionKeys(process.env);
  private readonly currentVersion = resolveCurrentCredentialKeyVersion(process.env);

  constructor(
    private readonly prismaDirect: PrismaDirectService,
    private readonly logger: LoggerService,
    // SEC-DB-RLS-001 M1a: credential reads and writes for a known tenant go through the tenant client, so they work when
    // the runtime role is not a superuser. Optional only so that tests which build this service by hand (and run as the
    // admin identity) keep working; Nest always injects it, and without it the old direct-client behaviour is kept.
    private readonly prisma?: PrismaService,
  ) {
    if (!this.keys.has(this.currentVersion)) {
      throw new Error(
        `Missing credential encryption key for current version ${this.currentVersion}.`,
      );
    }
  }

  /** The client for a known tenant: the tenant client when available (RLS-safe), the direct client otherwise (tests). */
  private clientForTenant(tenantKey: string): Prisma.TransactionClient {
    return this.prisma ? (this.prisma.tenant(tenantKey) as unknown as Prisma.TransactionClient) : this.prismaDirect.getClient();
  }

  getCurrentVersion(): number {
    return this.currentVersion;
  }

  encrypt(plain: string): { cipher: string; keyVersion: number } {
    return buildEncryptedCredential(plain, this.currentVersion, this.keys);
  }

  decrypt(cipher: string, keyVersion: string | number): string {
    const version = parseCredentialKeyVersion(keyVersion);
    const key = this.keys.get(version);
    if (!key) {
      throw new Error(`Missing credential encryption key for version ${version}.`);
    }
    return decryptCredentialValue(cipher, key);
  }

  /**
   * `tx` and `health` are both opt-in and additive (Checklist item B). Every
   * existing call site passes neither and sees zero behavior change — `tx`
   * defaults to the direct (non-transactional) client, and omitting `health`
   * never touches failureReason/lastValidatedAt, exactly as before this
   * parameter existed.
   */
  async storeCredential(
    input: StoreCredentialInput,
    tx?: Prisma.TransactionClient,
    health?: StoreCredentialHealth,
  ): Promise<{ id: string; keyVersion: string }> {
    const encrypted = this.encrypt(input.plainValue);
    const keyVersion = formatCredentialKeyVersion(encrypted.keyVersion);
    const id = `${input.installationId}:${input.credentialType}`;
    const db = tx ?? this.clientForTenant(input.tenantKey);
    const metadata: Prisma.InputJsonValue | typeof Prisma.DbNull = input.metadata
      ? (input.metadata as Prisma.InputJsonValue)
      : Prisma.DbNull;
    const healthFields = health
      ? {
          ...(health.failureReason !== undefined ? { failureReason: health.failureReason } : {}),
          ...(health.lastValidatedAt !== undefined ? { lastValidatedAt: health.lastValidatedAt } : {}),
        }
      : {};

    await db.connectorCredential.upsert({
      where: { id },
      create: {
        id,
        tenantKey: input.tenantKey,
        installationId: input.installationId,
        credentialType: input.credentialType,
        encryptedValue: encrypted.cipher,
        keyVersion,
        status: input.status ?? "ACTIVE",
        scope: input.scope ?? null,
        expiresAt: input.expiresAt ?? null,
        metadata,
        ...healthFields,
      },
      update: {
        tenantKey: input.tenantKey,
        encryptedValue: encrypted.cipher,
        keyVersion,
        status: input.status ?? "ACTIVE",
        scope: input.scope ?? null,
        expiresAt: input.expiresAt ?? null,
        metadata,
        updatedAt: new Date(),
        ...healthFields,
      },
    });

    return {
      id,
      keyVersion,
    };
  }

  /**
   * Opens a transaction on the SAME tenant-scoped connection storeCredential() writes through for that tenant. Callers that need
   * to atomically combine one or more storeCredential() calls with another write for the same tenant (e.g. ConnectorInstallation)
   * pass the yielded `tx` back into storeCredential()'s second argument. The tenant must be the tenant of every write inside `fn`.
   */
  async transaction<T>(tenantKey: string, fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    const client = this.prisma ? this.prisma.tenant(tenantKey) : this.prismaDirect.getClient();
    return client.$transaction(fn);
  }

  /**
   * Re-encrypts every tenant's credentials from one key version to another (operator procedure: scripts/rotate-credentials.ts).
   *
   * SEC-DB-RLS-001: this scans `connector_credentials` for rows on the old key version. It used to do that through the context-free
   * client, which under row level security sees only the default tenant, so a rotation would have covered one tenant and reported
   * success. It now iterates the tenants from the directory and rotates inside each tenant's own transaction (forEachTenant). A
   * failure for one tenant rolls back only that tenant; the result is then PARTIAL_FAILURE and `failed` is non-zero, never success.
   * Credentials whose tenant is missing from the directory are invisible to a restricted role: `tenants.orphanDetection` is
   * UNVERIFIED_BY_RUNTIME_ROLE, never zero.
   *
   * A dry run reports what would rotate for each tenant and writes nothing.
   */
  async rotateKey(options: RotateCredentialKeyOptions): Promise<RotateCredentialKeyResult> {
    const fromVersion = parseCredentialKeyVersion(options.fromVersion);
    const toVersion = parseCredentialKeyVersion(options.toVersion);
    if (fromVersion === toVersion) {
      throw new Error("fromVersion and toVersion must differ.");
    }

    if (!this.keys.has(fromVersion)) {
      throw new Error(`Missing configured key for fromVersion=${fromVersion}.`);
    }
    if (!this.keys.has(toVersion)) {
      throw new Error(`Missing configured key for toVersion=${toVersion}.`);
    }

    const batchSize = Math.min(
      Math.max(options.batchSize ?? DEFAULT_BATCH_SIZE, 1),
      MAX_BATCH_SIZE,
    );
    const dryRun = options.dryRun ?? false;
    const fromTag = formatCredentialKeyVersion(fromVersion);
    const fromLegacyTag = String(fromVersion);
    const toTag = formatCredentialKeyVersion(toVersion);
    const errors: string[] = [];

    const summary = await forEachTenant(this.prismaDirect.getClient(), async (tx, tenantKey) => {
      let examined = 0;
      let rotated = 0;
      let failed = 0;
      let lastId = "";

      while (true) {
        const rows = await tx.connectorCredential.findMany({
          where: {
            id: { gt: lastId },
            keyVersion: { in: [fromTag, fromLegacyTag] },
          },
          orderBy: [{ id: "asc" }],
          take: batchSize,
          select: {
            id: true,
            encryptedValue: true,
            keyVersion: true,
          },
        });

        if (rows.length === 0) {
          break;
        }
        examined += rows.length;

        for (const row of rows) {
          lastId = row.id;
          try {
            const rowVersion = parseCredentialKeyVersion(row.keyVersion);
            const plain = this.decrypt(row.encryptedValue, rowVersion);
            const rotatedValue = buildEncryptedCredential(plain, toVersion, this.keys);

            if (!dryRun) {
              await tx.connectorCredential.update({
                where: { id: row.id },
                data: {
                  encryptedValue: rotatedValue.cipher,
                  keyVersion: toTag,
                  updatedAt: new Date(),
                },
              });
            }

            rotated += 1;
          } catch (error) {
            failed += 1;
            const message = error instanceof Error ? error.message : String(error);
            errors.push(`${row.id}: ${message}`);
            this.logger.warn("Credential key rotation failed", {
              tenantKey,
              credentialId: row.id,
              fromVersion,
              toVersion,
              dryRun,
              error: message,
            });
          }
        }
      }

      return { examinedCount: examined, changedCount: rotated, failedCount: failed };
    });

    // A tenant whose whole transaction failed committed nothing; report it as a failure so the run cannot look successful.
    const result: RotateCredentialKeyResult = {
      rotated: summary.changedTotal,
      failed: summary.failedTotal,
      errors,
      status: summary.overall,
      tenants: summary,
    };
    for (const run of summary.results) {
      if (run.status === "failed" && run.errorCode !== "ITEM_FAILURES") {
        result.failed += 1;
        result.errors.push(`tenant ${run.tenantKey}: ${run.errorCode ?? "UNKNOWN_ERROR"}`);
      }
    }

    this.logger.info("Credential key rotation completed", {
      fromVersion,
      toVersion,
      dryRun,
      rotated: result.rotated,
      failed: result.failed,
      tenantsEvaluated: summary.tenantsEvaluated,
      tenantsFailed: summary.tenantsFailed,
      status: result.status,
    });

    return result;
  }
}
