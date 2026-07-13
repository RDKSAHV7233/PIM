/**
 * Integration tests for publish-remediation correctness.
 *
 * These tests require live PostgreSQL and Redis containers and are skipped
 * automatically when the services are unreachable. Run with:
 *
 *   INTEGRATION=1 npx jest --config jest.config.js -- publish-remediation.integration
 *
 * Prerequisites:
 *   docker compose up -d postgres redis
 */

import { PrismaClient } from "@prisma/client";

const SKIP = !process.env.INTEGRATION;
const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/pim1_migration_test";
const REDIS_HOST = process.env.REDIS_HOST ?? "localhost";
const REDIS_PORT = Number(process.env.REDIS_PORT ?? "6379");

const describeIntegration = SKIP ? describe.skip : describe;

// ---------------------------------------------------------------------------
// PostgreSQL: partial unique index behavioral tests
// ---------------------------------------------------------------------------

describeIntegration("PostgreSQL: partial unique index behavior", () => {
  let prisma: PrismaClient;
  const TENANT = "integration-test-" + Date.now();

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url: TEST_DB_URL } } });
    await prisma.$executeRaw`
      INSERT INTO "Category" (id, "tenantKey", name, slug, path, "createdAt", "updatedAt")
      VALUES (${TENANT + "-cat"}, ${TENANT}, 'IntTest', 'int-test', '/int-test', NOW(), NOW())
      ON CONFLICT DO NOTHING
    `;
    await prisma.$executeRaw`
      INSERT INTO "Product" (id, "tenantKey", title, "categoryId", status, "createdAt", "updatedAt")
      VALUES (${TENANT + "-prod"}, ${TENANT}, 'IntTest Prod', ${TENANT + "-cat"}, 'draft', NOW(), NOW())
      ON CONFLICT DO NOTHING
    `;
  });

  afterAll(async () => {
    await prisma.$executeRaw`DELETE FROM "MarketplaceExportJob" WHERE "tenantKey" = ${TENANT}`;
    await prisma.$executeRaw`DELETE FROM "Product" WHERE "tenantKey" = ${TENANT}`;
    await prisma.$executeRaw`DELETE FROM "Category" WHERE "tenantKey" = ${TENANT}`;
    await prisma.$disconnect();
  });

  afterEach(async () => {
    await prisma.$executeRaw`DELETE FROM "MarketplaceExportJob" WHERE "tenantKey" = ${TENANT}`;
  });

  it("allows first active job", async () => {
    const job = await prisma.marketplaceExportJob.create({
      data: {
        tenantKey: TENANT,
        productId: TENANT + "-prod",
        categoryId: TENANT + "-cat",
        channel: "shopify",
        status: "queued",
        installationId: "inst-1",
      },
    });
    expect(job.id).toBeTruthy();
  });

  it("rejects duplicate active job", async () => {
    await prisma.marketplaceExportJob.create({
      data: {
        tenantKey: TENANT,
        productId: TENANT + "-prod",
        categoryId: TENANT + "-cat",
        channel: "shopify",
        status: "queued",
        installationId: "inst-1",
      },
    });
    await expect(
      prisma.marketplaceExportJob.create({
        data: {
          tenantKey: TENANT,
          productId: TENANT + "-prod",
          categoryId: TENANT + "-cat",
          channel: "shopify",
          status: "processing",
          installationId: "inst-1",
        },
      }),
    ).rejects.toThrow(/Unique constraint/i);
  });

  it("allows terminal duplicate alongside active", async () => {
    await prisma.marketplaceExportJob.create({
      data: {
        tenantKey: TENANT,
        productId: TENANT + "-prod",
        categoryId: TENANT + "-cat",
        channel: "shopify",
        status: "completed",
        installationId: "inst-1",
      },
    });
    const active = await prisma.marketplaceExportJob.create({
      data: {
        tenantKey: TENANT,
        productId: TENANT + "-prod",
        categoryId: TENANT + "-cat",
        channel: "shopify",
        status: "queued",
        installationId: "inst-1",
      },
    });
    expect(active.status).toBe("queued");
  });

  it("allows multiple terminal rows", async () => {
    for (const status of ["completed", "failed", "dead_letter", "skipped"] as const) {
      await prisma.marketplaceExportJob.create({
        data: {
          tenantKey: TENANT,
          productId: TENANT + "-prod",
          categoryId: TENANT + "-cat",
          channel: "shopify",
          status,
          installationId: "inst-1",
        },
      });
    }
    const count = await prisma.marketplaceExportJob.count({
      where: { tenantKey: TENANT, installationId: "inst-1" },
    });
    expect(count).toBe(4);
  });

  it("allows new active after terminal transition", async () => {
    const first = await prisma.marketplaceExportJob.create({
      data: {
        tenantKey: TENANT,
        productId: TENANT + "-prod",
        categoryId: TENANT + "-cat",
        channel: "shopify",
        status: "queued",
        installationId: "inst-1",
      },
    });
    await prisma.marketplaceExportJob.update({
      where: { id: first.id },
      data: { status: "completed" },
    });
    const second = await prisma.marketplaceExportJob.create({
      data: {
        tenantKey: TENANT,
        productId: TENANT + "-prod",
        categoryId: TENANT + "-cat",
        channel: "shopify",
        status: "queued",
        installationId: "inst-1",
      },
    });
    expect(second.id).not.toBe(first.id);
    expect(second.status).toBe("queued");
  });

  it("captures P2002 with correct meta.target", async () => {
    await prisma.marketplaceExportJob.create({
      data: {
        tenantKey: TENANT,
        productId: TENANT + "-prod",
        categoryId: TENANT + "-cat",
        channel: "shopify",
        status: "queued",
        installationId: "inst-1",
      },
    });
    try {
      await prisma.marketplaceExportJob.create({
        data: {
          tenantKey: TENANT,
          productId: TENANT + "-prod",
          categoryId: TENANT + "-cat",
          channel: "shopify",
          status: "retrying",
          installationId: "inst-1",
        },
      });
      throw new Error("Should have thrown P2002");
    } catch (err: any) {
      expect(err.code).toBe("P2002");
      expect(Array.isArray(err.meta?.target)).toBe(true);
      const EXPECTED_DB_COLUMNS = ["tenantKey", "productId", "installation_id"];
      const target = err.meta.target as string[];
      expect(target.length).toBe(EXPECTED_DB_COLUMNS.length);
      for (const col of EXPECTED_DB_COLUMNS) {
        expect(target).toContain(col);
      }
    }
  });

  it("NULL installation_id bypasses the constraint", async () => {
    const a = await prisma.marketplaceExportJob.create({
      data: {
        tenantKey: TENANT,
        productId: TENANT + "-prod",
        categoryId: TENANT + "-cat",
        channel: "shopify",
        status: "queued",
        installationId: null,
      },
    });
    const b = await prisma.marketplaceExportJob.create({
      data: {
        tenantKey: TENANT,
        productId: TENANT + "-prod",
        categoryId: TENANT + "-cat",
        channel: "shopify",
        status: "queued",
        installationId: null,
      },
    });
    expect(a.id).not.toBe(b.id);
  });
});

// ---------------------------------------------------------------------------
// BullMQ: job ID format and deduplication
// ---------------------------------------------------------------------------

describeIntegration("BullMQ: job ID correctness with real Redis", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Queue } = require("bullmq") as typeof import("bullmq");
  let queue: InstanceType<typeof Queue>;
  const QUEUE_NAME = "pim1-integration-test-" + Date.now();

  beforeAll(() => {
    queue = new Queue(QUEUE_NAME, { connection: { host: REDIS_HOST, port: REDIS_PORT } });
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await queue.close();
  });

  it("accepts underscore-separated job ID", async () => {
    const job = await queue.add("test", { a: 1 }, { jobId: "cuid123_0" });
    expect(job.id).toBe("cuid123_0");
  });

  it("rejects colon-separated job ID", async () => {
    await expect(
      queue.add("test", { a: 1 }, { jobId: "cuid123:0" }),
    ).rejects.toThrow(/Custom Id cannot contain/);
  });

  it("deduplicates same job ID", async () => {
    const id = "dedup-test_0";
    await queue.add("test", { first: true }, { jobId: id });
    const dup = await queue.add("test", { second: true }, { jobId: id });
    expect(dup.id).toBe(id);
    const found = await queue.getJob(id);
    expect(found).toBeTruthy();
  });

  it("accepts different retryCount as different ID", async () => {
    const j0 = await queue.add("test", {}, { jobId: "multi_0" });
    const j1 = await queue.add("test", {}, { jobId: "multi_1" });
    expect(j0.id).toBe("multi_0");
    expect(j1.id).toBe("multi_1");
    const f0 = await queue.getJob("multi_0");
    const f1 = await queue.getJob("multi_1");
    expect(f0).toBeTruthy();
    expect(f1).toBeTruthy();
  });

  it("getJob returns null for absent job", async () => {
    const result = await queue.getJob("nonexistent_99");
    expect(result).toBeUndefined();
  });

  it("getJob discovers existing job (isJobPresent equivalent)", async () => {
    const id = "discover_0";
    await queue.add("test", { payload: "x" }, { jobId: id });
    const found = await queue.getJob(id);
    expect(found).toBeTruthy();
    expect(found!.id).toBe(id);
  });
});
