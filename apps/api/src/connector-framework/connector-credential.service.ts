import { Injectable } from "@nestjs/common";
import { LoggerService } from "../common/logging/logger.service";
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
  errors: number;
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
   * Re-encrypt all credentials not yet on the current key version.
   *
   * Safe to run multiple times (idempotent — skips credentials already on current version).
   * Run this after rotating CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION in env.
   * Called automatically by the heartbeat on startup when a version change is detected.
   */
  async rotateAllCredentials(): Promise<CredentialRotationResult> {
    const db = this.prismaDirect.getClient();
    const currentVersion = formatCredentialKeyVersion(this.currentKeyVersion);
    const currentKey = this.keys.get(this.currentKeyVersion);

    if (!currentKey) {
      throw new Error(
        `Cannot rotate credentials: missing encryption key for current version ${this.currentKeyVersion}. ` +
        `Ensure CREDENTIAL_ENCRYPTION_KEY_V${this.currentKeyVersion} is set.`,
      );
    }

    let rotated = 0;
    let skipped = 0;
    let errors = 0;

    const staleRows = await db.connectorCredential.findMany({
      where: { keyVersion: { not: currentVersion } },
      take: ROTATION_BATCH_SIZE,
      select: { id: true, encryptedValue: true, keyVersion: true },
    });

    this.logger.info("connector.credential.rotation_started", {
      staleCount: staleRows.length,
      targetVersion: currentVersion,
    });

    for (const row of staleRows) {
      try {
        const oldVersion = parseCredentialKeyVersion(row.keyVersion);
        const oldKey = this.keys.get(oldVersion);
        if (!oldKey) {
          this.logger.warn("connector.credential.rotation_skipped_missing_key", {
            credentialId: row.id,
            keyVersion: row.keyVersion,
          });
          skipped++;
          continue;
        }

        const plaintext = decryptCredentialValue(row.encryptedValue, oldKey);
        const newCipher = encryptCredentialValue(plaintext, currentKey, this.currentKeyVersion);

        await db.connectorCredential.updateMany({
          where: { id: row.id, keyVersion: row.keyVersion },
          data: {
            encryptedValue: newCipher,
            keyVersion: currentVersion,
            updatedAt: new Date(),
          },
        });
        rotated++;
      } catch (err) {
        errors++;
        this.logger.warn("connector.credential.rotation_error", {
          credentialId: row.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    this.logger.info("connector.credential.rotation_completed", {
      rotated,
      skipped,
      errors,
      targetVersion: currentVersion,
    });

    return { rotated, skipped, errors };
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
