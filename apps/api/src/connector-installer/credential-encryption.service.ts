import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
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
    const db = tx ?? this.prismaDirect.getClient();
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
   * Opens a transaction on the SAME direct-client connection storeCredential()
   * writes through. Callers that need to atomically combine one or more
   * storeCredential() calls with another write against a model reachable from
   * this connection (e.g. ConnectorInstallation) pass the yielded `tx` back
   * into storeCredential()'s second argument.
   */
  async transaction<T>(fn: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prismaDirect.getClient().$transaction(fn);
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
      const rows = await db.connectorCredential.findMany({
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

      for (const row of rows) {
        lastId = row.id;
        try {
          const rowVersion = parseCredentialKeyVersion(row.keyVersion);
          const plain = this.decrypt(row.encryptedValue, rowVersion);
          const rotated = buildEncryptedCredential(plain, toVersion, this.keys);

          if (!dryRun) {
            await db.connectorCredential.update({
              where: { id: row.id },
              data: {
                encryptedValue: rotated.cipher,
                keyVersion: toTag,
                updatedAt: new Date(),
              },
            });
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
