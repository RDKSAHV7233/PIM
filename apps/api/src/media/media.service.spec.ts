import { NotFoundException } from "@nestjs/common";
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

  it("still returns not found when the asset id does not exist", async () => {
    const { service } = makeService({ asset: null });

    await expect(service.getAssetFile("missing-asset")).rejects.toBeInstanceOf(NotFoundException);
  });
});
