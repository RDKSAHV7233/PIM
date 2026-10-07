// SEC-DB-RLS-001 D1: the public media file route reads the asset as the tenant named by a verified signed token.
//
// Three layers: the controller (verify BEFORE any lookup, one answer for every failure, no unsigned fallback once the key is
// configured), the service (the lookup runs on the token tenant's client; another tenant's asset id is simply not found), and the
// authenticated listing (it hands the tenant's own users the token the route requires).

import { Logger, UnauthorizedException } from "@nestjs/common";
import type { Response } from "express";
import { MediaController } from "./media.controller";
import { MediaService } from "./media.service";
import { buildPublicMediaFileUrl, signMediaToken, verifyMediaToken } from "./media-url-token";

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(8)]);
const KEY = "media-signing-key-for-tests-0123456789";
const OTHER_KEY = "another-media-signing-key-0123456789ab";
const withKey = (key: string) => ({ MEDIA_URL_SIGNING_KEY: key }) as NodeJS.ProcessEnv;

const originalKey = process.env.MEDIA_URL_SIGNING_KEY;
function restoreKey() {
  if (originalKey === undefined) {
    delete process.env.MEDIA_URL_SIGNING_KEY;
  } else {
    process.env.MEDIA_URL_SIGNING_KEY = originalKey;
  }
}

describe("MediaController.getAssetFile signed-token enforcement", () => {
  afterEach(() => {
    restoreKey();
    jest.restoreAllMocks();
  });

  function setup() {
    const getAssetFile = jest.fn().mockResolvedValue({ buffer: PNG, mimeType: "image/png", fileName: "a.png" });
    const controller = new MediaController({ getAssetFile } as never);
    const response = { header: () => response, redirect: jest.fn() } as unknown as Response;
    return { controller, getAssetFile, response };
  }

  it("a valid token: the asset is read AS the tenant named in the token", async () => {
    process.env.MEDIA_URL_SIGNING_KEY = KEY;
    const { controller, getAssetFile, response } = setup();

    await controller.getAssetFile("asset-b", signMediaToken({ tenantKey: "tenant-b", assetId: "asset-b" }), response);

    expect(getAssetFile).toHaveBeenCalledTimes(1);
    expect(getAssetFile).toHaveBeenCalledWith("asset-b", "tenant-b");
  });

  it.each([
    ["no token", undefined],
    ["an empty token", ""],
    ["garbage", "not-a-token"],
    ["a token for another asset", signMediaToken({ tenantKey: "tenant-b", assetId: "asset-OTHER" }, withKey(KEY))],
    ["an expired token", signMediaToken({ tenantKey: "tenant-b", assetId: "asset-b", nowMs: Date.now() - 30 * 24 * 3600 * 1000 }, withKey(KEY))],
    ["a token signed with another key", signMediaToken({ tenantKey: "tenant-b", assetId: "asset-b" }, withKey(OTHER_KEY))],
  ])("%s: refused with the SAME answer, and the database is never touched", async (_label, token) => {
    process.env.MEDIA_URL_SIGNING_KEY = KEY;
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const { controller, getAssetFile, response } = setup();

    const failure = await controller.getAssetFile("asset-b", token as string | undefined, response).catch((e) => e);

    expect(failure).toBeInstanceOf(UnauthorizedException);
    expect((failure as UnauthorizedException).getResponse()).toEqual({ error: "MEDIA_TOKEN_INVALID" });
    expect(getAssetFile).not.toHaveBeenCalled(); // verified BEFORE any lookup
  });

  it("with a key configured, an unsigned request is refused even for the default tenant (no unsigned fallback)", async () => {
    process.env.MEDIA_URL_SIGNING_KEY = KEY;
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const { controller, getAssetFile, response } = setup();
    await expect(controller.getAssetFile("asset-default", undefined, response)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(getAssetFile).not.toHaveBeenCalled();
  });

  it("without a key (rollout compatibility) the route behaves as before, reads with NO tenant, and warns once per process, not per request", async () => {
    delete process.env.MEDIA_URL_SIGNING_KEY;
    const warn = jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const { controller, getAssetFile, response } = setup();

    await controller.getAssetFile("asset-1", undefined, response);
    await controller.getAssetFile("asset-2", undefined, response);

    expect(getAssetFile).toHaveBeenNthCalledWith(1, "asset-1", undefined);
    expect(getAssetFile).toHaveBeenNthCalledWith(2, "asset-2", undefined);
    expect(warn.mock.calls.filter((c) => String(c[0]).includes("MEDIA_URL_SIGNING_KEY is not configured"))).toHaveLength(1);
  });

  it("a token supplied while no key is configured is not trusted: the tenant is never taken from an unverifiable token", async () => {
    delete process.env.MEDIA_URL_SIGNING_KEY;
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const { controller, getAssetFile, response } = setup();
    await controller.getAssetFile("asset-b", "v1.eyJ0IjoidGVuYW50LXZpY3RpbSJ9.AAAA", response);
    expect(getAssetFile).toHaveBeenCalledWith("asset-b", undefined);
  });
});

describe("MediaService.getAssetFile with a tenant (signed-token path)", () => {
  function makeService(assets: Record<string, { storagePath: string; mimeType: string; fileName: string }>) {
    // One tenant client per tenant that only "sees" that tenant's assets, like a row-level-security client.
    const tenantCalls: string[] = [];
    const prisma = {
      tenant: jest.fn((tenantKey: string) => {
        tenantCalls.push(tenantKey);
        return {
          mediaAsset: {
            findUnique: jest.fn(async ({ where }: { where: { id: string } }) => assets[`${tenantKey}:${where.id}`] ?? null),
          },
        };
      }),
    };
    const direct = {
      getClient: jest.fn(() => {
        throw new Error("the context-free client must not be used when a tenant is known");
      }),
    };
    const readLocalFile = jest.fn().mockResolvedValue(Buffer.from("tenant-b-bytes"));
    const service = new MediaService(prisma as never, direct as never, {} as never, { isLocalMode: () => true, readLocalFile, resolveDownloadUrl: jest.fn() } as never);
    return { service, tenantCalls, direct, readLocalFile };
  }

  const ASSETS = { "tenant-b:asset-b": { storagePath: "/app/storage/media/b/image.png", mimeType: "image/png", fileName: "image.png" } };

  it("serves a NON-DEFAULT tenant's asset through that tenant's client, never the context-free client", async () => {
    const { service, tenantCalls, direct, readLocalFile } = makeService(ASSETS);

    const file = await service.getAssetFile("asset-b", "tenant-b");

    expect(file.buffer?.toString()).toBe("tenant-b-bytes"); // bytes were actually read, not just "no error"
    expect(file).toMatchObject({ mimeType: "image/png", fileName: "image.png" });
    expect(tenantCalls).toEqual(["tenant-b"]);
    expect(direct.getClient).not.toHaveBeenCalled();
    expect(readLocalFile).toHaveBeenCalledWith("/app/storage/media/b/image.png");
  });

  it("another tenant's asset id is simply not found when the token names a different tenant", async () => {
    const { service, readLocalFile } = makeService(ASSETS);
    await expect(service.getAssetFile("asset-b", "tenant-attacker")).rejects.toThrow(/not found/i);
    expect(readLocalFile).not.toHaveBeenCalled();
  });
});

describe("MediaService.presentAsset fileToken", () => {
  afterEach(restoreKey);
  const present = (row: Record<string, unknown>) =>
    (new MediaService({} as never, {} as never, {} as never, {} as never) as unknown as { presentAsset: (r: unknown) => { fileToken: string | null } }).presentAsset({
      metadata: {},
      productId: null,
      variantId: null,
      ...row,
    });

  it("carries a token bound to the asset's own tenant and id once the signing key is configured", () => {
    process.env.MEDIA_URL_SIGNING_KEY = KEY;
    const out = present({ id: "asset-b", tenantKey: "tenant-b" });
    expect(typeof out.fileToken).toBe("string");
    expect(verifyMediaToken(out.fileToken, { assetId: "asset-b" }).tenantKey).toBe("tenant-b");
  });

  it("is null until the key is configured, so nothing changes before it is provisioned", () => {
    delete process.env.MEDIA_URL_SIGNING_KEY;
    expect(present({ id: "asset-b", tenantKey: "tenant-b" }).fileToken).toBeNull();
  });

  it("has no token for a row that carries no tenant (it never guesses one)", () => {
    process.env.MEDIA_URL_SIGNING_KEY = KEY;
    expect(present({ id: "asset-b" }).fileToken).toBeNull();
  });
});

describe("public media file URL for connector payloads", () => {
  it("is the plain path before the key is configured, and carries a verifying token after", () => {
    const base = { apiBase: "https://api.example.test/api/v1/", assetId: "asset-b", tenantKey: "tenant-b" };
    expect(buildPublicMediaFileUrl(base, {} as NodeJS.ProcessEnv)).toBe("https://api.example.test/api/v1/media/assets/asset-b/file");
    const signed = buildPublicMediaFileUrl(base, withKey(KEY));
    expect(signed.startsWith("https://api.example.test/api/v1/media/assets/asset-b/file?t=v1.")).toBe(true);
    const token = new URL(signed).searchParams.get("t");
    expect(verifyMediaToken(token, { assetId: "asset-b" }, withKey(KEY)).tenantKey).toBe("tenant-b");
  });
});
