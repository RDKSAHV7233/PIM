import { MediaStorageService } from "./media-storage.service";

const ORIGINAL_ENV = { ...process.env };

function makeObjectStorageService(send: jest.Mock) {
  process.env = {
    ...ORIGINAL_ENV,
    MEDIA_STORAGE_MODE: "object_storage",
    R2_ACCOUNT_ID: "account",
    R2_ACCESS_KEY_ID: "key",
    R2_SECRET_ACCESS_KEY: "secret",
    R2_BUCKET_NAME: "bucket",
    R2_ENDPOINT: "https://r2.example.test",
  };
  const service = new MediaStorageService();
  (service as unknown as { s3Client: { send: jest.Mock } }).s3Client = { send };
  return service;
}

describe("MediaStorageService integrity probes", () => {
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("uses object-storage HEAD and reports existing keys", async () => {
    const send = jest.fn().mockResolvedValue({});
    const service = makeObjectStorageService(send);

    await expect(service.probeObjectKey("media/admin/asset.jpg")).resolves.toEqual({ status: "exists" });

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      input: expect.objectContaining({
        Bucket: "bucket",
        Key: "media/admin/asset.jpg",
      }),
    }));
  });

  it("keeps missing distinct from storage errors", async () => {
    const missing = Object.assign(new Error("not found"), { name: "NotFound", $metadata: { httpStatusCode: 404 } });
    const send = jest.fn().mockRejectedValue(missing);
    const service = makeObjectStorageService(send);

    await expect(service.probeObjectKey("media/admin/missing.jpg")).resolves.toEqual({ status: "missing" });
  });

  it("treats object storage failures as storage_error instead of missing", async () => {
    const error = Object.assign(new Error("timeout"), { name: "TimeoutError", $metadata: { httpStatusCode: 503 } });
    const send = jest.fn().mockRejectedValue(error);
    const service = makeObjectStorageService(send);

    await expect(service.probeObjectKey("media/admin/error.jpg")).resolves.toEqual({
      status: "storage_error",
      reason: "TimeoutError",
    });
  });

  it("does not probe local files unless explicitly enabled", async () => {
    const service = makeObjectStorageService(jest.fn());

    await expect(service.probeLocalPath("/app/storage/media/admin/asset.jpg", false)).resolves.toEqual({
      status: "unverifiable",
      reason: "local_filesystem_probe_disabled",
    });
  });
});
