import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { LoggerService } from "../common/logging/logger.service";
import { forEachTenant, type TenantIterationOverall, type TenantIterationSummary } from "../common/tenant/tenant-iteration";
import { PrismaDirectService } from "../prisma/prisma-direct.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  decryptCredentialValue,
  encryptCredentialValue,
  formatCredentialKeyVersion,
  loadCredentialEncryptionKeys,
  parseCredentialKeyVersion,
  resolveCurrentCredentialKeyVersion,
} from "../connector-installer/credential-encryption.util";

// 5-minute buffer: refresh before expiry rather than at the moment of expiry
const ACCESS_TOKEN_BUFFER_MS = 5 * 60 * 1000;
// Rotate at most this many credentials per call to avoid long-running transactions
const ROTATION_BATCH_SIZE = 100;

export type CredentialRotationResult = {
  rotated: number;
  skipped: number;
  /** Credentials that could not be rotated (bad ciphertext, failed write). */
  errors: number;
  /** SUCCESS only when every tenant and every credential succeeded; otherwise PARTIAL_FAILURE or FAILED. */
  status: TenantIterationOverall;
  tenants: TenantIterationSummary;
};

@Injectable()
export class ConnectorCredentialService {
  private readonly keys: Map<number, Buffer>;
  private readonly currentKeyVersion: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly prismaDirect: PrismaDirectService,
    private readonly logger: LoggerService,
  ) {
    this.keys = loadCredentialEncryptionKeys(process.env);
    this.currentKeyVersion = resolveCurrentCredentialKeyVersion(process.env);
  }

  /**
   * Return a valid access token for the given installation.
   *
   * Fast path: if the stored access_token is fresh, decrypt and return it.
   * Slow path: call onRefreshNeeded() — the connector performs its OAuth exchange,
   *   persists the new tokens, and returns the new plain-text access token.
   */
  async getOrRefreshAccessToken(
    tenantKey: string,
    installationId: string,
    slug: string,
    onRefreshNeeded: () => Promise<string>,
  ): Promise<string> {
    const row = await this.prisma.tenant(tenantKey).connectorCredential.findFirst({
      where: { installationId, credentialType: "access_token" },
      select: { encryptedValue: true, keyVersion: true, expiresAt: true },
    });

    if (row && this.isTokenFresh(row.expiresAt)) {
      return this.decrypt(row.encryptedValue, row.keyVersion);
    }

    this.logger.info("connector.credential.refresh_needed", {
      slug,
      installationId,
    });

    return onRefreshNeeded();
  }

  /**
   * Re-encrypt all credentials not yet on the current key version, for EVERY tenant.
   *
   * Safe to run multiple times (idempotent — skips credentials already on current version).
   * Run this after rotating CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION in env.
   * Called automatically by the heartbeat on startup when a version change is detected.
   *
   * SEC-DB-RLS-001: this used to scan `connector_credentials` through the context-free client. Under row level security that client
   * sees only the default tenant, so a key rotation would have re-encrypted one tenant's credentials and reported success. It now
   * iterates the tenants from the directory and rotates inside each tenant's own transaction (see forEachTenant). A failure for one
   * tenant rolls back only that tenant; the others keep their committed rotation, and the result is PARTIAL_FAILURE, never SUCCESS.
   * `tenants.orphanDetection` is UNVERIFIED_BY_RUNTIME_ROLE: credentials whose tenant is not in the directory cannot be seen by a
   * restricted role, so this cannot prove there are none.
   *
   * Within a tenant it loops in ROTATION_BATCH_SIZE batches ordered by id with a `gt` cursor until every stale row is drained. The
   * cursor (not just the shrinking keyVersion filter) matters: a row that fails to rotate (bad ciphertext, missing key) never
   * changes keyVersion, so without a cursor it would be re-fetched and re-fail forever. A credential that cannot be rotated counts as
   * an item failure: the tenant is reported failed while its other rotations stay committed.
   */
  async rotateAllCredentials(): Promise<CredentialRotationResult> {
    const currentVersion = formatCredentialKeyVersion(this.currentKeyVersion);
    const currentKey = this.keys.get(this.currentKeyVersion);

    if (!currentKey) {
      throw new Error(
        `Cannot rotate credentials: missing encryption key for current version ${this.currentKeyVersion}. ` +
        `Ensure CREDENTIAL_ENCRYPTION_KEY_V${this.currentKeyVersion} is set.`,
      );
    }

    const skippedByTenant = new Map<string, number>();
    const summary = await forEachTenant(this.prismaDirect.getClient(), async (tx, tenantKey) => {
      const counts = await this.rotateTenantCredentials(tx, tenantKey, currentVersion, currentKey);
      skippedByTenant.set(tenantKey, counts.skipped);
      return { examinedCount: counts.examined, changedCount: counts.rotated, failedCount: counts.errors };
    });

    // Totals come from the per-tenant results, so a tenant whose transaction failed contributes nothing it did not commit.
    const committed = summary.results.filter((r) => r.status === "success" || r.errorCode === "ITEM_FAILURES");
    const result: CredentialRotationResult = {
      rotated: summary.changedTotal,
      skipped: committed.reduce((sum, r) => sum + (skippedByTenant.get(r.tenantKey) ?? 0), 0),
      errors: summary.failedTotal,
      status: summary.overall,
      tenants: summary,
    };

    this.logger.info("connector.credential.rotation_completed", {
      tenantsEvaluated: summary.tenantsEvaluated,
      tenantsFailed: summary.tenantsFailed,
      rotated: result.rotated,
      skipped: result.skipped,
      errors: result.errors,
      status: result.status,
      targetVersion: currentVersion,
    });
    return result;
  }

  private async rotateTenantCredentials(
    tx: Prisma.TransactionClient,
    tenantKey: string,
    currentVersion: string,
    currentKey: Buffer,
  ): Promise<{ examined: number; rotated: number; skipped: number; errors: number }> {
    let examined = 0;
    let rotated = 0;
    let skipped = 0;
    let errors = 0;
    let batchNumber = 0;
    let lastId = "";

    while (true) {
      const staleRows = await tx.connectorCredential.findMany({
        where: { id: { gt: lastId }, keyVersion: { not: currentVersion } },
        orderBy: [{ id: "asc" }],
        take: ROTATION_BATCH_SIZE,
        select: { id: true, encryptedValue: true, keyVersion: true },
      });

      if (staleRows.length === 0) {
        break;
      }

      batchNumber++;
      examined += staleRows.length;
      this.logger.info("connector.credential.rotation_batch_started", {
        tenantKey,
        batchNumber,
        batchCount: staleRows.length,
        targetVersion: currentVersion,
      });

      for (const row of staleRows) {
        lastId = row.id;
        try {
          const oldVersion = parseCredentialKeyVersion(row.keyVersion);
          const oldKey = this.keys.get(oldVersion);
          if (!oldKey) {
            this.logger.warn("connector.credential.rotation_skipped_missing_key", {
              tenantKey,
              credentialId: row.id,
              keyVersion: row.keyVersion,
            });
            skipped++;
            continue;
          }

          const plaintext = decryptCredentialValue(row.encryptedValue, oldKey);
          const newCipher = encryptCredentialValue(plaintext, currentKey, this.currentKeyVersion);

          const updated = await tx.connectorCredential.updateMany({
            where: { id: row.id, keyVersion: row.keyVersion },
            data: {
              encryptedValue: newCipher,
              keyVersion: currentVersion,
              updatedAt: new Date(),
            },
          });
          // A row that matched the read but not the write was changed or removed meanwhile: that is not a rotation.
          if (updated.count === 1) {
            rotated++;
          } else {
            skipped++;
          }
        } catch (err) {
          errors++;
          this.logger.warn("connector.credential.rotation_error", {
            tenantKey,
            credentialId: row.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    return { examined, rotated, skipped, errors };
  }

  private isTokenFresh(expiresAt: Date | null): boolean {
    if (!expiresAt) {
      // No expiry set — treat as permanently valid (e.g. Shopify offline tokens without refresh)
      return true;
    }
    return expiresAt.getTime() - ACCESS_TOKEN_BUFFER_MS > Date.now();
  }

  private decrypt(encryptedValue: string, keyVersionRaw: string | number): string {
    const version = parseCredentialKeyVersion(keyVersionRaw);
    const key = this.keys.get(version);
    if (!key) {
      throw new Error(`Missing credential encryption key for version ${version}.`);
    }
    return decryptCredentialValue(encryptedValue, key);
  }
}
