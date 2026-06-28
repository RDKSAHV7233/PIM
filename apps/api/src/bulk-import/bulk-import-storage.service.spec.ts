import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BulkImportStorageService } from "./bulk-import-storage.service";

describe("BulkImportStorageService", () => {
  const originalEnv = { ...process.env };
  const originalCwd = process.cwd();
  const tempDirs: string[] = [];

  afterEach(async () => {
    process.env = { ...originalEnv };
    process.chdir(originalCwd);
    await Promise.all(
      tempDirs.splice(0).map(async (dir) => {
        await fs.rm(dir, { recursive: true, force: true });
      }),
    );
  });

  async function createTempWorkspace() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "bulk-import-storage-"));
    tempDirs.push(dir);
    process.chdir(dir);
    return dir;
  }

  function createService(overrides?: Record<string, string | undefined>) {
    process.env = {
      ...originalEnv,
      APP_ENV: "development",
      R2_ENDPOINT: "",
      R2_ACCOUNT_ID: "local-dev",
      R2_ACCESS_KEY_ID: "local-dev",
      R2_SECRET_ACCESS_KEY: "local-dev",
      R2_BUCKET_NAME: "vexa-pim-local",
      ...overrides,
    };
    return new BulkImportStorageService();
  }

  it("uses filesystem fallback for placeholder account ids in development", async () => {
    await createTempWorkspace();
    const service = createService({ R2_ACCOUNT_ID: "replace-me" });

    expect((service as any).useLocalFallback).toBe(true);

    const { storageKey } = await service.storeStagedCsv({
      tenantKey: "tenant-a",
      runId: "run-1",
      content: Buffer.from("sku,title\nsku-1,Shirt\n", "utf8"),
    });

    expect(path.isAbsolute(storageKey)).toBe(true);
    await expect(fs.readFile(storageKey, "utf8")).resolves.toContain("sku-1,Shirt");
  });

  it("does not enable filesystem fallback in staging for placeholder account ids", () => {
    const service = createService({ APP_ENV: "staging", R2_ACCOUNT_ID: "replace-me" });

    expect((service as any).useLocalFallback).toBe(false);
  });

  it("does not enable filesystem fallback when an explicit endpoint is configured", () => {
    const service = createService({
      R2_ACCOUNT_ID: "replace-me",
      R2_ENDPOINT: "http://127.0.0.1:9000",
    });

    expect((service as any).useLocalFallback).toBe(false);
  });
});
