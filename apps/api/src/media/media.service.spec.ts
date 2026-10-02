import { BadRequestException, NotFoundException } from "@nestjs/common";
import { MediaService } from "./media.service";

function makeService(options: {
  asset?: { storagePath: string; mimeType: string; fileName: string } | null;
  localMode?: boolean;
  fileBuffer?: Buffer;
}) {
  const tenantFindUnique = jest.fn(() => {
    throw new Error("tenant-scoped lookup must not be used for public media file reads");
  });
  const directFindUnique = jest.fn().mockResolvedValue(options.asset ?? null);
  const readLocalFile = jest.fn().mockResolvedValue(options.fileBuffer ?? Buffer.from("image-bytes"));
  const resolveDownloadUrl = jest.fn().mockResolvedValue("https://cdn.example.test/media/image.jpg");

  const service = new MediaService(
    { tenant: () => ({ mediaAsset: { findUnique: tenantFindUnique } }) } as any,
    { getClient: () => ({ mediaAsset: { findUnique: directFindUnique } }) } as any,
    {} as any,
    {
      isLocalMode: () => options.localMode ?? true,
      readLocalFile,
      resolveDownloadUrl,
    } as any,
  );

  return { service, directFindUnique, tenantFindUnique, readLocalFile, resolveDownloadUrl };
}

describe("MediaService.getAssetFile", () => {
  it("uses the direct client so public file reads work for non-default tenants", async () => {
    const buffer = Buffer.from("restored-media");
    const { service, directFindUnique, tenantFindUnique, readLocalFile } = makeService({
      asset: { storagePath: "/app/storage/media/admin/asset.jpg", mimeType: "image/jpeg", fileName: "asset.jpg" },
      fileBuffer: buffer,
    });

    await expect(service.getAssetFile("asset-1")).resolves.toEqual({
      buffer,
      mimeType: "image/jpeg",
      fileName: "asset.jpg",
    });

    expect(directFindUnique).toHaveBeenCalledWith({
      where: { id: "asset-1" },
      select: { storagePath: true, mimeType: true, fileName: true },
    });
    expect(tenantFindUnique).not.toHaveBeenCalled();
    expect(readLocalFile).toHaveBeenCalledWith("/app/storage/media/admin/asset.jpg");
  });

  it("serves legacy local paths even when new uploads use object storage", async () => {
    const buffer = Buffer.from("legacy-media");
    const { service, readLocalFile, resolveDownloadUrl } = makeService({
      asset: { storagePath: "/app/storage/media/admin/legacy.jpg", mimeType: "image/jpeg", fileName: "legacy.jpg" },
      fileBuffer: buffer,
      localMode: false,
    });

    await expect(service.getAssetFile("legacy-asset")).resolves.toEqual({
      buffer,
      mimeType: "image/jpeg",
      fileName: "legacy.jpg",
    });

    expect(readLocalFile).toHaveBeenCalledWith("/app/storage/media/admin/legacy.jpg");
    expect(resolveDownloadUrl).not.toHaveBeenCalled();
  });

  it("keeps object-backed assets on the R2 download path", async () => {
    const { service, readLocalFile, resolveDownloadUrl } = makeService({
      asset: { storagePath: "media/admin/object.jpg", mimeType: "image/jpeg", fileName: "object.jpg" },
      localMode: false,
    });

    await expect(service.getAssetFile("object-asset")).resolves.toEqual({
      redirectUrl: "https://cdn.example.test/media/image.jpg",
      mimeType: "image/jpeg",
      fileName: "object.jpg",
    });

    expect(readLocalFile).not.toHaveBeenCalled();
    expect(resolveDownloadUrl).toHaveBeenCalledWith("media/admin/object.jpg", "object.jpg");
  });

  it("still returns not found when the asset id does not exist", async () => {
    const { service } = makeService({ asset: null });

    await expect(service.getAssetFile("missing-asset")).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("MediaService upload validation (prod-cert DEF-PC-002)", () => {
  const upload = (service: unknown, mimeType: string, contentBuffer: Buffer, fileName = "x.png") =>
    (service as { createAssetFromBuffer: (i: unknown) => Promise<unknown> }).createAssetFromBuffer({
      entity: { productId: null, variantId: null, entityType: "product" },
      fileName,
      mimeType,
      contentBuffer,
      source: "direct_upload",
      sourceRef: null,
    });

  it("rejects a declared text/html upload (cannot host a live page on the public asset URL)", async () => {
    const { service } = makeService({});
    await expect(upload(service, "text/html", Buffer.from("<html><script>alert(1)</script></html>"), "x.html")).rejects.toBeInstanceOf(BadRequestException);
  });

  it("rejects image/svg+xml and unknown types", async () => {
    const { service } = makeService({});
    await expect(upload(service, "image/svg+xml", Buffer.from("<svg/>"), "x.svg")).rejects.toThrow(/Unsupported media type/);
    await expect(upload(service, "application/x-evil", Buffer.from("zz"), "x.bin")).rejects.toThrow(/Unsupported media type/);
  });

  it("rejects HTML bytes that are merely declared as image/png", async () => {
    const { service } = makeService({});
    await expect(upload(service, "image/png", Buffer.from("<html><script>alert(1)</script></html>"))).rejects.toThrow(/does not match the declared image type/);
  });

  it("rejects a JPEG file declared as PNG (content/type mismatch)", async () => {
    const { service } = makeService({});
    await expect(upload(service, "image/png", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]))).rejects.toThrow(/does not match/);
  });
});

describe("MediaService upload acceptance (prod-cert DEF-PC-002, AC3: real images still work)", () => {
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(24)]);
  const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);

  function makeUploadService() {
    const create = jest.fn().mockResolvedValue({});
    const upload = jest.fn().mockResolvedValue("media/default/stored-key.png");
    const service = new MediaService(
      { tenant: () => ({ mediaAsset: { findFirst: jest.fn().mockResolvedValue(null), create } }) } as any,
      {} as any,
      {} as any,
      { upload } as any,
    );
    jest.spyOn(service as any, "getAsset").mockResolvedValue({ id: "asset-1" });
    return { service, create, upload };
  }

  const run = (service: unknown, mimeType: string, contentBuffer: Buffer, fileName = "x.png") =>
    (service as { createAssetFromBuffer: (i: unknown) => Promise<unknown> }).createAssetFromBuffer({
      entity: { productId: null, variantId: null, entityType: "product" },
      fileName,
      mimeType,
      contentBuffer,
      source: "direct_upload",
      sourceRef: null,
    });

  it("accepts a real PNG and stores it with the normalised image/png type", async () => {
    const { service, create, upload } = makeUploadService();
    await expect(run(service, "image/png", PNG)).resolves.toEqual({ id: "asset-1" });
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({ mimeType: "image/png" }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ mimeType: "image/png" }) }));
  });

  it("normalises a declared IMAGE/JPG; with real JPEG bytes it is stored as image/jpeg", async () => {
    const { service, create } = makeUploadService();
    await run(service, "IMAGE/JPG", JPEG, "photo.jpg");
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ mimeType: "image/jpeg" }) }));
  });

  it("accepts a real PNG sent with the bulk default type application/octet-stream and stores it as image/png", async () => {
    const { service, create, upload } = makeUploadService();
    await run(service, "application/octet-stream", PNG, "sku-1.bin");
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({ mimeType: "image/png" }));
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ mimeType: "image/png" }) }));
  });

  it("still rejects octet-stream content that is not an image, with the standard VALIDATION_FAILED envelope", async () => {
    const { service } = makeUploadService();
    await expect(run(service, "application/octet-stream", Buffer.from("<html></html>"), "x.bin")).rejects.toMatchObject({
      response: { error: "VALIDATION_FAILED", fields: [expect.objectContaining({ field: "mimeType" })] },
    });
  });

  it("stores an uploaded GIF with a .gif extension when the filename has none", async () => {
    const { service, upload } = makeUploadService();
    await run(service, "image/gif", Buffer.from("GIF89a\u0001\u0000", "latin1"), "animation");
    expect(upload).toHaveBeenCalledWith(expect.objectContaining({ extension: ".gif" }));
  });

  it("never reaches storage or the database for a rejected upload", async () => {
    const { service, create, upload } = makeUploadService();
    await expect(run(service, "text/html", Buffer.from("<html></html>"), "x.html")).rejects.toBeInstanceOf(BadRequestException);
    expect(upload).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });
});
