// Coverage for AuthExportStorageService — zero test coverage before, despite
// building filesystem/object-storage paths for account-export artifacts
// directly from caller-supplied tenantId/userId/jobId values via
// sanitizeSegment(). If that sanitization has a gap, a crafted tenant or job
// id could write (or overwrite) a file outside the intended per-tenant
// export directory — a real path-traversal risk, not a hypothetical one.
//
// Forces the filesystem backend (ACCOUNT_EXPORT_STORAGE_MODE=filesystem)
// against a real temp directory rather than mocking fs or the S3 client —
// this proves the actual path construction never escapes the configured
// root, using real node:fs writes and real path resolution, not a mocked
// assertion about what the code "should" do.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

describe("AuthExportStorageService — filesystem backend path safety (no prior coverage)", () => {
  let tempRoot: string;
  const originalEnv = process.env;

  beforeEach(async () => {
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "pim1-export-test-"));
    process.env = {
      ...originalEnv,
      ACCOUNT_EXPORT_STORAGE_MODE: "filesystem",
      ACCOUNT_EXPORT_STORAGE_DIR: tempRoot,
    };
    jest.resetModules();
  });

  afterEach(async () => {
    process.env = originalEnv;
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  function loadService() {
    const { AuthExportStorageService } = require("./auth-export-storage.service");
    return new AuthExportStorageService();
  }

  it("writes a normal export inside the configured per-tenant directory", async () => {
    const service = loadService();

    const result = await service.storeAccountExportArtifact({
      tenantId: "tenant-a",
      userId: "user-1",
      jobId: "job-1",
      format: "json",
      fileContents: '{"ok":true}',
    });

    expect(path.resolve(result.storagePath).startsWith(path.resolve(tempRoot) + path.sep)).toBe(true);
    const written = await fs.readFile(result.storagePath, "utf8");
    expect(written).toBe('{"ok":true}');
  });

  it.each([
    "../../../../etc/passwd",
    "..\\..\\..\\windows\\system32",
    "tenant/../../escape",
    "....//....//escape",
  ])("never escapes the configured storage root when tenantId is the malicious value %j", async (maliciousValue) => {
    const service = loadService();

    const result = await service.storeAccountExportArtifact({
      tenantId: maliciousValue,
      userId: "user-1",
      jobId: "job-1",
      format: "json",
      fileContents: "{}",
    });

    const resolvedPath = path.resolve(result.storagePath);
    const resolvedRoot = path.resolve(tempRoot);
    expect(resolvedPath === resolvedRoot || resolvedPath.startsWith(resolvedRoot + path.sep)).toBe(true);
  });

  it("also sanitizes a malicious jobId — the filename itself can't traverse either", async () => {
    const service = loadService();

    const result = await service.storeAccountExportArtifact({
      tenantId: "tenant-a",
      userId: "user-1",
      jobId: "../../escape-job",
      format: "csv",
      fileContents: "a,b,c",
    });

    const resolvedPath = path.resolve(result.storagePath);
    const resolvedRoot = path.resolve(tempRoot);
    expect(resolvedPath.startsWith(resolvedRoot + path.sep)).toBe(true);
    expect(result.fileName).not.toContain("..");
    expect(result.fileName).not.toContain("/");
  });

  it("falls back to a safe default name when every character in a segment is stripped", async () => {
    const service = loadService();

    const result = await service.storeAccountExportArtifact({
      tenantId: "tenant-a",
      userId: "!!!///???", // strips to nothing
      jobId: "***",
      format: "json",
      fileContents: "{}",
    });

    expect(result.fileName).toContain("export");
    const resolvedPath = path.resolve(result.storagePath);
    expect(resolvedPath.startsWith(path.resolve(tempRoot) + path.sep)).toBe(true);
  });

  it("resolveAccountExportDownload reads back a real stored export by its absolute path", async () => {
    const service = loadService();
    const stored = await service.storeAccountExportArtifact({
      tenantId: "tenant-a",
      userId: "user-1",
      jobId: "job-1",
      format: "json",
      fileContents: '{"round":"trip"}',
    });

    const download = await service.resolveAccountExportDownload({
      artifactPath: stored.storagePath,
      format: "json",
      fileName: stored.fileName,
    });

    expect(download.kind).toBe("binary");
    expect(download.content.toString("utf8")).toBe('{"round":"trip"}');
  });

  it("resolveAccountExportDownload returns unavailable (not a thrown error) for an empty artifact path", async () => {
    const service = loadService();

    const download = await service.resolveAccountExportDownload({
      artifactPath: null,
      format: "json",
      fileName: "export.json",
    });

    expect(download.kind).toBe("unavailable");
  });

  it("resolveAccountExportDownload returns unavailable for a path that no longer exists (expired/cleaned up)", async () => {
    const service = loadService();

    const download = await service.resolveAccountExportDownload({
      artifactPath: path.join(tempRoot, "tenant-a", "never-existed.json"),
      format: "json",
      fileName: "export.json",
    });

    expect(download.kind).toBe("unavailable");
  });
});
