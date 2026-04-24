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
    const metadata: Prisma.InputJsonValue | typeof Prisma.DbNull = input.metadata
      ? (input.metadata as Prisma.InputJsonValue)
      : Prisma.DbNull;

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
      },
    });

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
