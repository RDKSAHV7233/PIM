import { Injectable } from "@nestjs/common";
import { LoggerService } from "../common/logging/logger.service";
import { PrismaDirectService } from "../prisma/prisma-direct.service";
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

@Injectable()
export class ConnectorCredentialEncryptionService {
  private readonly keys = loadCredentialEncryptionKeys(process.env);
  private readonly currentVersion = resolveCurrentCredentialKeyVersion(process.env);

  constructor(
    private readonly prismaDirect: PrismaDirectService,
    private readonly logger: LoggerService,
  ) {
    if (!this.keys.has(this.currentVersion)) {
      throw new Error(
        `Missing credential encryption key for current version ${this.currentVersion}.`,
      );
    }
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

  async storeCredential(input: StoreCredentialInput): Promise<{ id: string; keyVersion: string }> {
    const encrypted = this.encrypt(input.plainValue);
    const keyVersion = formatCredentialKeyVersion(encrypted.keyVersion);
    const id = `${input.installationId}:${input.credentialType}`;
    const db = this.prismaDirect.getClient();
    const metadata = input.metadata ? JSON.stringify(input.metadata) : null;

    // RLS-BYPASS: manual tenant filter
    await db.$executeRawUnsafe(
      `
      INSERT INTO connector_credentials (
        id,
        tenant_key,
        installation_id,
        credential_type,
        encrypted_value,
        key_version,
        status,
        scope,
        expires_at,
        metadata,
        created_at,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        COALESCE($7, 'ACTIVE'),
        $8,
        $9,
        CASE WHEN $10::jsonb IS NULL THEN NULL ELSE $10::jsonb END,
        NOW(),
        NOW()
      )
      ON CONFLICT (installation_id, credential_type)
      DO UPDATE SET
        tenant_key = EXCLUDED.tenant_key,
        encrypted_value = EXCLUDED.encrypted_value,
        key_version = EXCLUDED.key_version,
        status = EXCLUDED.status,
        scope = EXCLUDED.scope,
        expires_at = EXCLUDED.expires_at,
        metadata = EXCLUDED.metadata,
        updated_at = NOW()
      `,
      id,
      input.tenantKey,
      input.installationId,
      input.credentialType,
      encrypted.cipher,
      keyVersion,
      input.status ?? "ACTIVE",
      input.scope ?? null,
      input.expiresAt ?? null,
      metadata,
    );

    return {
      id,
      keyVersion,
    };
  }

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
    const db = this.prismaDirect.getClient();

    const result: RotateCredentialKeyResult = {
      rotated: 0,
      failed: 0,
      errors: [],
    };

    let lastId = "";
    const fromTag = formatCredentialKeyVersion(fromVersion);
    const fromLegacyTag = String(fromVersion);
    const toTag = formatCredentialKeyVersion(toVersion);

    while (true) {
      // RLS-BYPASS: manual tenant filter
      const rows = await db.$queryRawUnsafe<CredentialRow[]>(
        `
        SELECT
          id,
          encrypted_value AS "encryptedValue",
          key_version AS "keyVersion"
        FROM connector_credentials
        WHERE id > $1
          AND key_version IN ($2, $3)
        ORDER BY id ASC
        LIMIT $4
        `,
        lastId,
        fromTag,
        fromLegacyTag,
        batchSize,
      );

      if (rows.length === 0) {
        break;
      }

      for (const row of rows) {
        lastId = row.id;
        try {
          const rowVersion = parseCredentialKeyVersion(row.keyVersion);
          const plain = this.decrypt(row.encryptedValue, rowVersion);
          const rotated = buildEncryptedCredential(plain, toVersion, this.keys);

          if (!dryRun) {
            // RLS-BYPASS: manual tenant filter
            await db.$executeRawUnsafe(
              `
              UPDATE connector_credentials
              SET encrypted_value = $2,
                  key_version = $3,
                  updated_at = NOW()
              WHERE id = $1
              `,
              row.id,
              rotated.cipher,
              toTag,
            );
          }

          result.rotated += 1;
        } catch (error) {
          result.failed += 1;
          const message = error instanceof Error ? error.message : String(error);
          result.errors.push(`${row.id}: ${message}`);
          this.logger.warn("Credential key rotation failed", {
            credentialId: row.id,
            fromVersion,
            toVersion,
            dryRun,
            error: message,
          });
        }
      }
    }

    this.logger.info("Credential key rotation completed", {
      fromVersion,
      toVersion,
      dryRun,
      rotated: result.rotated,
      failed: result.failed,
    });

    return result;
  }
}
