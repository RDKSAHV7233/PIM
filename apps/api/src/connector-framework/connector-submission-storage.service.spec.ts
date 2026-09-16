// Coverage for ConnectorSubmissionStorageService — zero test coverage
// before, despite building filesystem paths for oversized connector
// submission payload snapshots directly from caller-supplied tenantKey/
// jobId via sanitize(). Same path-traversal risk shape already proven out
// for AuthExportStorageService (PR #840) — checked here too, against the
// real filesystem backend and a real temp directory, not mocks.
//
// resolveLocalStorageRoot() now matches AuthExportStorageService's
// resolveFilesystemStorageRoot() pattern: path.resolve() on a configured
// dir (so an absolute CONNECTOR_SNAPSHOT_STORAGE_DIR actually relocates
// storage there), path.join(cwd, default) when unset. Tests below compute
// the real expected root the same way the service does, and clean that up.

import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

function expectedRootFor(configuredDir: string): string {
  return path.resolve(configuredDir);
}

describe("ConnectorSubmissionStorageService — filesystem backend path safety (no prior coverage)", () => {
  let configuredDir: string;
  let realRoot: string;
  const originalEnv = process.env;

  beforeEach(async () => {
    // A relative, unique directory name — this is the normal, supported configuration shape.
    configuredDir = path.join("storage", `pim1-snapshot-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    realRoot = expectedRootFor(configuredDir);
    process.env = {
      ...originalEnv,
      CONNECTOR_SNAPSHOT_STORAGE_MODE: "filesystem",
      CONNECTOR_SNAPSHOT_STORAGE_DIR: configuredDir,
    };
    jest.resetModules();
  });

  afterEach(async () => {
    process.env = originalEnv;
    await fs.rm(realRoot, { recursive: true, force: true });
  });

  function loadService() {
    const { ConnectorSubmissionStorageService } = require("./connector-submission-storage.service");
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return new ConnectorSubmissionStorageService(logger as any);
  }

  it("writes a normal snapshot inside the configured per-tenant directory", async () => {
    const service = loadService();

    const result = await service.storeSnapshot({ tenantKey: "tenant-a", jobId: "job-1", content: '{"ok":true}' });

    expect(path.resolve(result.storageKey).startsWith(path.resolve(realRoot) + path.sep)).toBe(true);
    const written = await fs.readFile(result.storageKey, "utf8");
    expect(written).toBe('{"ok":true}');
    expect(result.accessUrl).toBe(result.storageKey);
  });

  it.each([
    "../../../../etc/passwd",
    "..\\..\\..\\windows\\system32",
    "tenant/../../escape",
    "....//....//escape",
  ])("never escapes the configured storage root when tenantKey is the malicious value %j", async (maliciousValue) => {
    const service = loadService();

    const result = await service.storeSnapshot({ tenantKey: maliciousValue, jobId: "job-1", content: "{}" });

    const resolvedPath = path.resolve(result.storageKey);
    const resolvedRoot = path.resolve(realRoot);
    expect(resolvedPath === resolvedRoot || resolvedPath.startsWith(resolvedRoot + path.sep)).toBe(true);
  });

  it("also sanitizes a malicious jobId — the filename itself can't traverse either", async () => {
    const service = loadService();

    const result = await service.storeSnapshot({ tenantKey: "tenant-a", jobId: "../../escape-job", content: "{}" });

    const resolvedPath = path.resolve(result.storageKey);
    expect(resolvedPath.startsWith(path.resolve(realRoot) + path.sep)).toBe(true);
    expect(path.basename(result.storageKey)).not.toContain("..");
  });

  it("falls back to a safe default name when every character in a segment is stripped", async () => {
    const service = loadService();

    const result = await service.storeSnapshot({ tenantKey: "!!!///???", jobId: "***", content: "{}" });

    expect(result.storageKey).toContain("unknown");
    expect(path.resolve(result.storageKey).startsWith(path.resolve(realRoot) + path.sep)).toBe(true);
  });

  it("an absolute CONNECTOR_SNAPSHOT_STORAGE_DIR actually relocates storage there, not nested under cwd", async () => {
    const absoluteDir = await fs.mkdtemp(path.join(os.tmpdir(), "pim1-snapshot-abs-test-"));
    process.env = {
      ...originalEnv,
      CONNECTOR_SNAPSHOT_STORAGE_MODE: "filesystem",
      CONNECTOR_SNAPSHOT_STORAGE_DIR: absoluteDir,
    };
    jest.resetModules();

    try {
      const service = loadService();
      const result = await service.storeSnapshot({ tenantKey: "tenant-a", jobId: "job-1", content: "{}" });

      // Must land inside the absolute dir itself — not path.join(cwd, absoluteDir),
      // which would nest it somewhere unrelated under the repo root instead.
      expect(path.resolve(result.storageKey).startsWith(path.resolve(absoluteDir) + path.sep)).toBe(true);
      expect(result.storageKey.startsWith(path.join(process.cwd(), absoluteDir))).toBe(false);
    } finally {
      await fs.rm(absoluteDir, { recursive: true, force: true });
    }
  });
});

describe("ConnectorSubmissionStorageService — backend selection (no prior coverage)", () => {
  const originalEnv = process.env;
  let configuredDir: string;
  let realRoot: string;

  beforeEach(() => {
    configuredDir = path.join("storage", `pim1-snapshot-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    realRoot = expectedRootFor(configuredDir);
  });

  afterEach(async () => {
    process.env = originalEnv;
    jest.resetModules();
    await fs.rm(realRoot, { recursive: true, force: true });
  });

  function loadService(env: Record<string, string>) {
    process.env = { ...originalEnv, ...env, CONNECTOR_SNAPSHOT_STORAGE_DIR: configuredDir };
    jest.resetModules();
    const { ConnectorSubmissionStorageService } = require("./connector-submission-storage.service");
    const logger = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    return new ConnectorSubmissionStorageService(logger as any);
  }

  it("CONNECTOR_SNAPSHOT_STORAGE_MODE=filesystem overrides everything else, even a configured R2 account", async () => {
    const service = loadService({ CONNECTOR_SNAPSHOT_STORAGE_MODE: "filesystem", R2_ACCOUNT_ID: "real-account-id" });

    const result = await service.storeSnapshot({ tenantKey: "tenant-a", jobId: "job-1", content: "{}" });

    expect(path.resolve(result.storageKey).startsWith(path.resolve(realRoot))).toBe(true);
  });

  it("falls back to filesystem when no R2 account is configured at all (local dev default)", async () => {
    const service = loadService({ R2_ACCOUNT_ID: "" });

    const result = await service.storeSnapshot({ tenantKey: "tenant-a", jobId: "job-1", content: "{}" });

    expect(path.resolve(result.storageKey).startsWith(path.resolve(realRoot))).toBe(true);
  });
});
