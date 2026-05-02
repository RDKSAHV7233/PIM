import { BadRequestException, Injectable, UnauthorizedException } from "@nestjs/common";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { type AppRole } from "../common/rbac/roles";
import { normalizeTenantKey } from "../common/tenant/tenant.constants";
import { AuditService } from "../audit/audit.service";
import { PrismaService } from "../prisma/prisma.service";
import {
  buildEncryptedCredential,
  decryptCredentialValue,
  formatCredentialKeyVersion,
  loadCredentialEncryptionKeys,
  parseCredentialKeyVersion,
  resolveCurrentCredentialKeyVersion,
} from "../connector-installer/credential-encryption.util";

const MFA_METHOD_TOTP = "totp";
const MFA_TOTP_DIGITS = 6;
const MFA_TOTP_PERIOD_SECONDS = 30;
const MFA_TOTP_WINDOW_STEPS = 1;
const MFA_BACKUP_CODE_COUNT = 8;
const MFA_BACKUP_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function normalizeUserId(value: string): string {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeMfaCode(value: string): string {
  return String(value ?? "").trim().replace(/[\s-]+/g, "").toUpperCase();
}

function encodeBase32(input: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function decodeBase32(input: string): Buffer {
  const normalized = input.replace(/=+$/g, "").replace(/\s+/g, "").toUpperCase();
  let bits = 0;
  let value = 0;
  const output: number[] = [];
  for (const char of normalized) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) {
      throw new Error("Invalid base32 input.");
    }
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

function hotp(secret: Buffer, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac("sha1", secret).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  return String(binary % 10 ** MFA_TOTP_DIGITS).padStart(MFA_TOTP_DIGITS, "0");
}

function totp(secretBase32: string, atMs: number): string {
  const counter = Math.floor(atMs / 1000 / MFA_TOTP_PERIOD_SECONDS);
  return hotp(decodeBase32(secretBase32), counter);
}

@Injectable()
export class MfaService {
  private readonly encryptionKeys = loadCredentialEncryptionKeys(process.env);
  private readonly currentKeyVersion = resolveCurrentCredentialKeyVersion(process.env);

  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {
    if (!this.encryptionKeys.has(this.currentKeyVersion)) {
      throw new Error(`Missing credential encryption key for current version ${this.currentKeyVersion}.`);
    }
  }

  async getStatus(userIdInput: string, tenantIdInput: string) {
    const tenantId = normalizeTenantKey(tenantIdInput);
    const userId = normalizeUserId(userIdInput);
    const policy = await this.prisma.tenant(tenantId).tenantAuthPolicy.findUnique({
      where: { tenantKey: tenantId },
      select: {
        mfaRequired: true,
        mfaGracePeriodDays: true,
      },
    });
    const enrollment = await this.prisma.tenant(tenantId).userMfaEnrollment.findUnique({
      where: {
        tenantKey_userId_method: {
          tenantKey: tenantId,
          userId,
          method: MFA_METHOD_TOTP,
        },
      },
      select: {
        id: true,
        status: true,
        secretPreview: true,
        enrolledAt: true,
        verifiedAt: true,
        createdAt: true,
        backupCodes: {
          where: { consumedAt: null },
          select: { id: true },
        },
      },
    });

    return {
      method: MFA_METHOD_TOTP,
      isEnabled: enrollment?.status === "active",
      isPending: enrollment?.status === "pending",
      secretPreview: enrollment?.secretPreview ?? null,
      enrolledAt: enrollment?.enrolledAt?.toISOString() ?? null,
      verifiedAt: enrollment?.verifiedAt?.toISOString() ?? null,
      backupCodesRemaining: enrollment?.backupCodes.length ?? 0,
      pendingStartedAt: enrollment?.createdAt?.toISOString() ?? null,
      policy: {
        mfaRequired: policy?.mfaRequired ?? false,
        mfaGracePeriodDays: policy?.mfaGracePeriodDays ?? 7,
        enforcementActive: false,
      },
    };
  }

  async beginEnrollment(userIdInput: string, tenantIdInput: string, role: AppRole) {
    const tenantId = normalizeTenantKey(tenantIdInput);
    const userId = normalizeUserId(userIdInput);
    await this.assertIdentityExists(userId, tenantId);

    const secret = encodeBase32(randomBytes(20));
    const encrypted = buildEncryptedCredential(secret, this.currentKeyVersion, this.encryptionKeys);
    const now = new Date();
    const enrollment = await this.prisma.tenant(tenantId).userMfaEnrollment.upsert({
      where: {
        tenantKey_userId_method: {
          tenantKey: tenantId,
          userId,
          method: MFA_METHOD_TOTP,
        },
      },
      create: {
        tenantKey: tenantId,
        userId,
        method: MFA_METHOD_TOTP,
        status: "pending",
        secretEncrypted: encrypted.cipher,
        secretKeyVersion: formatCredentialKeyVersion(encrypted.keyVersion),
        secretPreview: `${secret.slice(0, 4)}-${secret.slice(-4)}`,
        enrolledAt: null,
        verifiedAt: null,
        lastUsedAt: null,
        createdAt: now,
        updatedAt: now,
      },
      update: {
        status: "pending",
        secretEncrypted: encrypted.cipher,
        secretKeyVersion: formatCredentialKeyVersion(encrypted.keyVersion),
        secretPreview: `${secret.slice(0, 4)}-${secret.slice(-4)}`,
        enrolledAt: null,
        verifiedAt: null,
        lastUsedAt: null,
        updatedAt: now,
        backupCodes: {
          deleteMany: {},
        },
      },
      select: {
        id: true,
        status: true,
        secretPreview: true,
        createdAt: true,
      },
    });

    await this.auditService.record({
      actorId: userId,
      actorRole: role,
      action: "auth.mfa_enrollment_started",
      resource: "user_mfa_enrollments",
      resourceId: enrollment.id,
      tenantKey: tenantId,
      metadata: {
        method: MFA_METHOD_TOTP,
        status: enrollment.status,
      },
    });

    return {
      method: MFA_METHOD_TOTP,
      status: enrollment.status,
      manualEntryKey: secret,
      secretPreview: enrollment.secretPreview ?? `${secret.slice(0, 4)}-${secret.slice(-4)}`,
      otpauthUri: this.buildOtpAuthUri(userId, secret, tenantId),
      setupLabel: this.buildOtpLabel(userId, tenantId),
      startedAt: enrollment.createdAt.toISOString(),
    };
  }

  async verifyEnrollment(userIdInput: string, tenantIdInput: string, role: AppRole, codeInput: string) {
    const tenantId = normalizeTenantKey(tenantIdInput);
    const userId = normalizeUserId(userIdInput);
    const enrollment = await this.requireEnrollment(userId, tenantId);
    const secret = this.decryptSecret(enrollment.secretEncrypted, enrollment.secretKeyVersion);

    if (!this.verifyTotp(secret, codeInput)) {
      throw new UnauthorizedException({ error: "MFA_CODE_INVALID" });
    }

    const backupCodes = this.generateBackupCodes();
    const now = new Date();
    await this.prisma.tenant(tenantId).$transaction([
      this.prisma.tenant(tenantId).userMfaBackupCode.deleteMany({
        where: { enrollmentId: enrollment.id },
      }),
      this.prisma.tenant(tenantId).userMfaEnrollment.update({
        where: { id: enrollment.id },
        data: {
          status: "active",
          enrolledAt: enrollment.enrolledAt ?? now,
          verifiedAt: now,
          lastUsedAt: now,
        },
      }),
      this.prisma.tenant(tenantId).userMfaBackupCode.createMany({
        data: backupCodes.map((code) => ({
          tenantKey: tenantId,
          userId,
          enrollmentId: enrollment.id,
          codeHash: this.hashBackupCode(tenantId, userId, code),
        })),
      }),
    ]);

    await this.auditService.record({
      actorId: userId,
      actorRole: role,
      action: "auth.mfa_enrollment_verified",
      resource: "user_mfa_enrollments",
      resourceId: enrollment.id,
      tenantKey: tenantId,
      metadata: {
        method: MFA_METHOD_TOTP,
        backupCodeCount: backupCodes.length,
      },
    });

    return {
      ok: true,
      method: MFA_METHOD_TOTP,
      backupCodes,
      enrolledAt: now.toISOString(),
    };
  }

  async regenerateBackupCodes(userIdInput: string, tenantIdInput: string, role: AppRole, codeInput: string) {
    const tenantId = normalizeTenantKey(tenantIdInput);
    const userId = normalizeUserId(userIdInput);
    const enrollment = await this.requireActiveEnrollment(userId, tenantId);
    const secret = this.decryptSecret(enrollment.secretEncrypted, enrollment.secretKeyVersion);

    if (!this.verifyTotp(secret, codeInput)) {
      throw new UnauthorizedException({ error: "MFA_CODE_INVALID" });
    }

    const backupCodes = this.generateBackupCodes();
    const now = new Date();
    await this.prisma.tenant(tenantId).$transaction([
      this.prisma.tenant(tenantId).userMfaBackupCode.deleteMany({
        where: { enrollmentId: enrollment.id },
      }),
      this.prisma.tenant(tenantId).userMfaBackupCode.createMany({
        data: backupCodes.map((code) => ({
          tenantKey: tenantId,
          userId,
          enrollmentId: enrollment.id,
          codeHash: this.hashBackupCode(tenantId, userId, code),
        })),
      }),
      this.prisma.tenant(tenantId).userMfaEnrollment.update({
        where: { id: enrollment.id },
        data: {
          lastUsedAt: now,
        },
      }),
    ]);

    await this.auditService.record({
      actorId: userId,
      actorRole: role,
      action: "auth.mfa_backup_codes_regenerated",
      resource: "user_mfa_enrollments",
      resourceId: enrollment.id,
      tenantKey: tenantId,
      metadata: {
        method: MFA_METHOD_TOTP,
        backupCodeCount: backupCodes.length,
      },
    });

    return {
      ok: true,
      backupCodes,
      regeneratedAt: now.toISOString(),
    };
  }

  private async assertIdentityExists(userId: string, tenantId: string): Promise<void> {
    const identity = await this.prisma.tenant(tenantId).authIdentity.findFirst({
      where: {
        tenantKey: tenantId,
        userId,
        isActive: true,
      },
      select: { id: true },
    });
    if (!identity) {
      throw new BadRequestException({ error: "MFA_IDENTITY_NOT_FOUND" });
    }
  }

  private async requireEnrollment(userId: string, tenantId: string) {
    const enrollment = await this.prisma.tenant(tenantId).userMfaEnrollment.findUnique({
      where: {
        tenantKey_userId_method: {
          tenantKey: tenantId,
          userId,
          method: MFA_METHOD_TOTP,
        },
      },
      select: {
        id: true,
        status: true,
        secretEncrypted: true,
        secretKeyVersion: true,
        enrolledAt: true,
      },
    });
    if (!enrollment) {
      throw new BadRequestException({ error: "MFA_ENROLLMENT_NOT_STARTED" });
    }
    return enrollment;
  }

  private async requireActiveEnrollment(userId: string, tenantId: string) {
    const enrollment = await this.requireEnrollment(userId, tenantId);
    if (enrollment.status !== "active") {
      throw new BadRequestException({ error: "MFA_NOT_ENABLED" });
    }
    return enrollment;
  }

  private decryptSecret(cipher: string, keyVersion: string): string {
    const version = parseCredentialKeyVersion(keyVersion);
    const key = this.encryptionKeys.get(version);
    if (!key) {
      throw new Error(`Missing credential encryption key for version ${version}.`);
    }
    return decryptCredentialValue(cipher, key);
  }

  private verifyTotp(secret: string, codeInput: string): boolean {
    const normalizedCode = normalizeMfaCode(codeInput);
    if (!/^\d{6}$/.test(normalizedCode)) {
      return false;
    }
    const now = Date.now();
    for (let offset = -MFA_TOTP_WINDOW_STEPS; offset <= MFA_TOTP_WINDOW_STEPS; offset += 1) {
      const candidate = totp(secret, now + offset * MFA_TOTP_PERIOD_SECONDS * 1000);
      if (candidate === normalizedCode) {
        return true;
      }
    }
    return false;
  }

  private generateBackupCodes(): string[] {
    return Array.from({ length: MFA_BACKUP_CODE_COUNT }, () => {
      const chars = Array.from(randomBytes(8), (value) => MFA_BACKUP_CODE_CHARS[value % MFA_BACKUP_CODE_CHARS.length]);
      return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}`;
    });
  }

  private hashBackupCode(tenantId: string, userId: string, code: string): string {
    return createHash("sha256")
      .update(`${tenantId}:${userId}:${normalizeMfaCode(code)}`, "utf8")
      .digest("hex");
  }

  private buildOtpAuthUri(userId: string, secret: string, tenantId: string): string {
    const issuer = "Vexa PIM";
    const label = this.buildOtpLabel(userId, tenantId);
    const params = new URLSearchParams({
      secret,
      issuer,
      algorithm: "SHA1",
      digits: String(MFA_TOTP_DIGITS),
      period: String(MFA_TOTP_PERIOD_SECONDS),
    });
    return `otpauth://totp/${encodeURIComponent(label)}?${params.toString()}`;
  }

  private buildOtpLabel(userId: string, tenantId: string): string {
    return `${tenantId}:${userId}`;
  }
}
