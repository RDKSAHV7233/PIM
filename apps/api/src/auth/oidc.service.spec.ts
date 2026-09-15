// Coverage for OidcService — the SSO login flow (CSRF-state validation,
// PKCE, claims-to-role mapping) had zero test coverage. oidc-auth.service.spec.ts
// explicitly stubbed this class out entirely (jest.mock("./oidc.service", () =>
// ({ OidcService: class {} }))) because the real module requires the ESM-only
// "openid-client" package at load time, which doesn't import cleanly under
// this repo's CommonJS ts-jest setup. Mocking the "openid-client" module
// itself (rather than the whole service) turns out to work fine — this
// exercises the real OidcService class end to end.

jest.mock("openid-client", () => ({
  discovery: jest.fn(),
  randomPKCECodeVerifier: jest.fn(),
  calculatePKCECodeChallenge: jest.fn(),
  authorizationCodeGrant: jest.fn(),
}));

import { UnauthorizedException, UnprocessableEntityException } from "@nestjs/common";
import { OidcService } from "./oidc.service";
import type { OidcConfigService } from "./oidc-config.service";

const oidcClient = require("openid-client");

function makeConfigStub(overrides: Partial<Awaited<ReturnType<OidcConfigService["getDecrypted"]>>> = {}) {
  const cfg = {
    issuer: "https://idp.example.com",
    clientId: "client-1",
    clientSecret: "secret",
    callbackUrl: "https://app.example.com/auth/oidc/callback",
    scopes: ["openid", "email", "profile"],
    claimsMapping: {
      groups: { engineering: "editor", ops: "channel_manager" },
    },
    ...overrides,
  };
  const oidcConfigService = { getDecrypted: jest.fn().mockResolvedValue(cfg) } as unknown as OidcConfigService;
  return { oidcConfigService, cfg };
}

describe("OidcService — SSO login flow (no prior coverage)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    oidcClient.discovery.mockResolvedValue({
      serverMetadata: () => ({ authorization_endpoint: "https://idp.example.com/authorize" }),
    });
    oidcClient.randomPKCECodeVerifier.mockReturnValue("verifier-value");
    oidcClient.calculatePKCECodeChallenge.mockResolvedValue("challenge-value");
  });

  it("builds an authorization URL with PKCE and a fresh state, and stores that state for the callback", async () => {
    const { oidcConfigService } = makeConfigStub();
    const service = new OidcService(oidcConfigService);

    const { url, state } = await service.buildAuthorizationUrl("tenant-a");

    expect(url).toContain("https://idp.example.com/authorize?");
    expect(url).toContain("code_challenge=challenge-value");
    expect(url).toContain("code_challenge_method=S256");
    expect(state).toHaveLength(32); // 16 random bytes, hex-encoded
  });

  it("throws when the discovered IdP metadata has no authorization endpoint", async () => {
    oidcClient.discovery.mockResolvedValue({ serverMetadata: () => ({}) });
    const { oidcConfigService } = makeConfigStub();
    const service = new OidcService(oidcConfigService);

    await expect(service.buildAuthorizationUrl("tenant-a")).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it("completes a valid callback, mapping array-valued group claims to the configured roles", async () => {
    const { oidcConfigService } = makeConfigStub();
    const service = new OidcService(oidcConfigService);
    const { state } = await service.buildAuthorizationUrl("tenant-a");
    oidcClient.authorizationCodeGrant.mockResolvedValue({
      claims: () => ({ sub: "user-123", email: "person@example.com", name: "Person", groups: ["engineering", "unmapped-group"] }),
    });

    const result = await service.handleCallback(state, "auth-code-1");

    expect(result).toMatchObject({
      tenantKey: "tenant-a",
      sub: "user-123",
      email: "person@example.com",
      name: "Person",
    });
    expect(result.effectiveRoles).toEqual(["editor"]);
  });

  it("rejects an unknown or already-consumed state — a state can only be used once", async () => {
    const { oidcConfigService } = makeConfigStub();
    const service = new OidcService(oidcConfigService);
    const { state } = await service.buildAuthorizationUrl("tenant-a");
    oidcClient.authorizationCodeGrant.mockResolvedValue({ claims: () => ({ sub: "user-123" }) });

    await service.handleCallback(state, "auth-code-1");

    await expect(service.handleCallback(state, "auth-code-1")).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("rejects a token exchange with no subject claim, even though the exchange itself succeeded", async () => {
    const { oidcConfigService } = makeConfigStub();
    const service = new OidcService(oidcConfigService);
    const { state } = await service.buildAuthorizationUrl("tenant-a");
    oidcClient.authorizationCodeGrant.mockResolvedValue({ claims: () => ({ email: "person@example.com" }) });

    await expect(service.handleCallback(state, "auth-code-1")).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("wraps a failed token exchange (bad code, revoked, network) in a generic UnauthorizedException", async () => {
    const { oidcConfigService } = makeConfigStub();
    const service = new OidcService(oidcConfigService);
    const { state } = await service.buildAuthorizationUrl("tenant-a");
    oidcClient.authorizationCodeGrant.mockRejectedValue(new Error("idp says no"));

    await expect(service.handleCallback(state, "auth-code-1")).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it("ignores a claim value that isn't in the configured mapping, without throwing", async () => {
    const { oidcConfigService } = makeConfigStub();
    const service = new OidcService(oidcConfigService);
    const { state } = await service.buildAuthorizationUrl("tenant-a");
    oidcClient.authorizationCodeGrant.mockResolvedValue({
      claims: () => ({ sub: "user-123", groups: ["totally-unrelated-group"] }),
    });

    const result = await service.handleCallback(state, "auth-code-1");

    expect(result.effectiveRoles).toEqual([]);
  });

  it("de-duplicates roles when multiple claim values map to the same role", async () => {
    const { oidcConfigService } = makeConfigStub({
      claimsMapping: { groups: { "team-a": "editor", "team-b": "editor" } },
    });
    const service = new OidcService(oidcConfigService);
    const { state } = await service.buildAuthorizationUrl("tenant-a");
    oidcClient.authorizationCodeGrant.mockResolvedValue({
      claims: () => ({ sub: "user-123", groups: ["team-a", "team-b"] }),
    });

    const result = await service.handleCallback(state, "auth-code-1");

    expect(result.effectiveRoles).toEqual(["editor"]);
  });
});
