import { Injectable, Logger, UnauthorizedException, UnprocessableEntityException } from "@nestjs/common";
import { randomBytes } from "node:crypto";
import { AppRole, FOUNDATION_ROLES, FoundationRole } from "../common/rbac/roles";
import { OidcConfigService } from "./oidc-config.service";

// openid-client v6 — loaded via require for CJS compatibility
// eslint-disable-next-line @typescript-eslint/no-require-imports
const oidcClient = require("openid-client") as {
  discovery: (issuerUrl: URL, clientId: string, clientSecret: string) => Promise<{ serverMetadata(): { authorization_endpoint?: string } }>;
  randomPKCECodeVerifier: () => string;
  calculatePKCECodeChallenge: (verifier: string) => Promise<string>;
  authorizationCodeGrant: (config: unknown, currentUrl: URL, opts: { pkceCodeVerifier?: string; expectedState?: string }) => Promise<{ claims(): Record<string, unknown> | undefined }>;
};

const STATE_TTL_MS = 10 * 60 * 1000;
const stateStore = new Map<string, { tenantKey: string; expiresAt: number; codeVerifier?: string }>();

function pruneExpiredStates() {
  const now = Date.now();
  for (const [key, value] of stateStore.entries()) {
    if (value.expiresAt < now) {
      stateStore.delete(key);
    }
  }
}

@Injectable()
export class OidcService {
  private readonly logger = new Logger(OidcService.name);

  constructor(private readonly oidcConfigService: OidcConfigService) {}

  async buildAuthorizationUrl(tenantKey: string): Promise<{ url: string; state: string }> {
    const cfg = await this.oidcConfigService.getDecrypted(tenantKey);
    const config = await oidcClient.discovery(new URL(cfg.issuer), cfg.clientId, cfg.clientSecret);

    const state = randomBytes(16).toString("hex");
    const codeVerifier = oidcClient.randomPKCECodeVerifier();
    const codeChallenge = await oidcClient.calculatePKCECodeChallenge(codeVerifier);

    pruneExpiredStates();
    stateStore.set(state, {
      tenantKey,
      expiresAt: Date.now() + STATE_TTL_MS,
      codeVerifier,
    });

    const params = new URLSearchParams({
      response_type: "code",
      client_id: cfg.clientId,
      redirect_uri: cfg.callbackUrl,
      scope: cfg.scopes.join(" "),
      state,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
    });

    const authorizationEndpoint = config.serverMetadata().authorization_endpoint;
    if (!authorizationEndpoint) {
      throw new UnprocessableEntityException("IdP does not expose an authorization endpoint.");
    }

    return { url: `${authorizationEndpoint}?${params.toString()}`, state };
  }

  async handleCallback(
    state: string,
    code: string,
    redirectUri?: string,
  ): Promise<{ tenantKey: string; sub: string; email: string; name?: string; claimsRaw: Record<string, unknown>; effectiveRoles: FoundationRole[] }> {
    pruneExpiredStates();
    const stored = stateStore.get(state);
    if (!stored || stored.expiresAt < Date.now()) {
      stateStore.delete(state);
      throw new UnauthorizedException("Invalid or expired OIDC state parameter.");
    }
    stateStore.delete(state);

    const { tenantKey, codeVerifier } = stored;
    const cfg = await this.oidcConfigService.getDecrypted(tenantKey);
    const config = await oidcClient.discovery(new URL(cfg.issuer), cfg.clientId, cfg.clientSecret);

    const callbackUrl = redirectUri ?? cfg.callbackUrl;
    const currentUrl = new URL(callbackUrl);
    currentUrl.searchParams.set("code", code);
    currentUrl.searchParams.set("state", state);

    let tokens: { claims(): Record<string, unknown> | undefined };
    try {
      tokens = await oidcClient.authorizationCodeGrant(config, currentUrl, {
        pkceCodeVerifier: codeVerifier,
        expectedState: state,
      });
    } catch (err) {
      this.logger.warn(`OIDC token exchange failed for tenant ${tenantKey}: ${String(err)}`);
      throw new UnauthorizedException("OIDC token exchange failed.");
    }

    const claims = tokens.claims();
    if (!claims) {
      throw new UnauthorizedException("OIDC token contained no claims.");
    }

    const claimsRaw = claims as Record<string, unknown>;
    const sub = typeof claims.sub === "string" ? claims.sub : "";
    const email = typeof claimsRaw["email"] === "string" ? claimsRaw["email"] : "";
    const name = typeof claimsRaw["name"] === "string" ? claimsRaw["name"] : undefined;

    if (!sub) {
      throw new UnauthorizedException("OIDC token missing subject claim.");
    }

    const effectiveRoles = this.mapClaimsToRoles(claimsRaw, cfg.claimsMapping);

    return { tenantKey, sub, email, name, claimsRaw, effectiveRoles };
  }

  private mapClaimsToRoles(claims: Record<string, unknown>, mapping: Record<string, unknown>): FoundationRole[] {
    const roles: FoundationRole[] = [];

    for (const [claimKey, claimMapping] of Object.entries(mapping)) {
      const claimValue = claims[claimKey];
      if (!claimMapping || typeof claimMapping !== "object") {
        continue;
      }
      const claimMappingObj = claimMapping as Record<string, string>;

      const values: unknown[] = Array.isArray(claimValue) ? claimValue : [claimValue];
      for (const val of values) {
        if (typeof val === "string" && claimMappingObj[val]) {
          const mapped = claimMappingObj[val];
          if (FOUNDATION_ROLES.includes(mapped as FoundationRole)) {
            roles.push(mapped as FoundationRole);
          }
        }
      }
    }

    return Array.from(new Set(roles));
  }
}
