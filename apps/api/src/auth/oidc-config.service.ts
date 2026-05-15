import { Injectable, NotFoundException, UnprocessableEntityException } from "@nestjs/common";
import {
  buildEncryptedCredential,
  decryptCredentialValue,
  formatCredentialKeyVersion,
  loadCredentialEncryptionKeys,
  parseCredentialKeyVersion,
  resolveCurrentCredentialKeyVersion,
} from "../connector-installer/credential-encryption.util";
import { PrismaService } from "../prisma/prisma.service";
import { UpsertOidcConfigDto } from "./dto/upsert-oidc-config.dto";

export interface OidcConfigView {
  issuer: string;
  clientId: string;
  callbackUrl: string;
  scopes: string[];
  claimsMapping: Record<string, unknown>;
  status: string;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class OidcConfigService {
  private readonly credentialKeys = loadCredentialEncryptionKeys(process.env);
  private readonly currentKeyVersion = resolveCurrentCredentialKeyVersion(process.env);

  constructor(private readonly prisma: PrismaService) {}

  async upsert(tenantKey: string, dto: UpsertOidcConfigDto, actorId?: string): Promise<OidcConfigView> {
    const { cipher: clientSecretEnc, keyVersion } = buildEncryptedCredential(dto.clientSecret, this.currentKeyVersion, this.credentialKeys);
    const clientSecretKeyVersion = formatCredentialKeyVersion(keyVersion);
    const data = {
      issuer: dto.issuer.trim().replace(/\/$/, ""),
      clientId: dto.clientId.trim(),
      clientSecretEnc,
      clientSecretKeyVersion,
      callbackUrl: dto.callbackUrl.trim(),
      scopes: dto.scopes ?? ["openid", "email", "profile"],
      claimsMapping: (dto.claimsMapping ?? {}) as object,
      status: "active",
      updatedBy: actorId ?? null,
    };

    const row = await this.prisma.tenant(tenantKey).oidcConfig.upsert({
      where: { tenantKey },
      create: { ...data, tenantKey, createdBy: actorId ?? null },
      update: data,
    });

    return this.toView(row);
  }

  async get(tenantKey: string): Promise<OidcConfigView> {
    const row = await this.prisma.tenant(tenantKey).oidcConfig.findUnique({ where: { tenantKey } });
    if (!row) {
      throw new NotFoundException("OIDC configuration not found for this tenant.");
    }
    return this.toView(row);
  }

  async delete(tenantKey: string): Promise<void> {
    const row = await this.prisma.tenant(tenantKey).oidcConfig.findUnique({ where: { tenantKey } });
    if (!row) {
      throw new NotFoundException("OIDC configuration not found.");
    }
    await this.prisma.tenant(tenantKey).oidcConfig.delete({ where: { tenantKey } });
  }

  async getDecrypted(tenantKey: string): Promise<{ issuer: string; clientId: string; clientSecret: string; callbackUrl: string; scopes: string[]; claimsMapping: Record<string, unknown> }> {
    const row = await this.prisma.tenant(tenantKey).oidcConfig.findUnique({ where: { tenantKey } });
    if (!row || row.status !== "active") {
      throw new UnprocessableEntityException("OIDC is not configured or disabled for this tenant.");
    }
    const keyVersion = parseCredentialKeyVersion(row.clientSecretKeyVersion);
    const key = this.credentialKeys.get(keyVersion);
    if (!key) {
      throw new UnprocessableEntityException(`Missing credential encryption key for version ${keyVersion}.`);
    }
    const clientSecret = decryptCredentialValue(row.clientSecretEnc, key);
    return {
      issuer: row.issuer,
      clientId: row.clientId,
      clientSecret,
      callbackUrl: row.callbackUrl,
      scopes: row.scopes,
      claimsMapping: row.claimsMapping as Record<string, unknown>,
    };
  }

  private toView(row: { issuer: string; clientId: string; callbackUrl: string; scopes: string[]; claimsMapping: unknown; status: string; createdAt: Date; updatedAt: Date }): OidcConfigView {
    return {
      issuer: row.issuer,
      clientId: row.clientId,
      callbackUrl: row.callbackUrl,
      scopes: row.scopes,
      claimsMapping: row.claimsMapping as Record<string, unknown>,
      status: row.status,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
