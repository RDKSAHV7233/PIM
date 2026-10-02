"use strict";

// Reconciles a provider-settling readback only. It never calls Shopify and it
// deliberately preserves the original failed submission status.
const crypto = require("node:crypto");
const fs = require("node:fs");
const { PrismaClient } = require("@prisma/client");

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  const value = index >= 0 ? String(process.argv[index + 1] ?? "").trim() : "";
  if (!value) throw new Error(`Missing required argument --${name}`);
  return value;
}

function normalized(value) {
  if (Array.isArray(value)) return value.map(normalized);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalized(item)]).sort(([left], [right]) => left.localeCompare(right)));
  }
  const text = String(value ?? "").trim();
  return text || null;
}

function sha256(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function readSnapshot(filePath) {
  const document = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const product = document.snapshot?.product ?? document.product;
  if (!product || typeof product !== "object") throw new Error(`Snapshot ${filePath} has no product.`);
  return product;
}

function verify(before, after, expectedProductGid, expectedAlt) {
  const { images: beforeImages = [], ...beforeStable } = before;
  const { images: afterImages = [], ...afterStable } = after;
  const beforeImageHash = sha256(normalized(beforeImages.map(({ id, altText }) => ({ id, altText }))));
  const afterImageHash = sha256(normalized(afterImages.map(({ id, altText }) => ({ id, altText }))));
  return {
    stableFieldsMatch: sha256(beforeStable) === sha256(afterStable),
    imageChanged: beforeImageHash !== afterImageHash,
    productGidUnchanged: before.id === after.id && after.id === expectedProductGid,
    expectedImagePresent: afterImages.some((image) => String(image.altText ?? "").trim() === expectedAlt),
    expectedImageCount: 1,
    actualImageCount: afterImages.length,
    beforeImageHash,
    afterImageHash,
  };
}

async function main() {
  const tenant = arg("tenant");
  const installation = arg("installation");
  const product = arg("product");
  const submissionId = arg("submission");
  const expectedProductGid = arg("shopifyProductGid");
  const expectedAlt = arg("expectedAlt");
  const expectedChecksum = arg("payloadChecksum").toLowerCase();
  const before = readSnapshot(arg("before"));
  const after = readSnapshot(arg("after"));
  const runUrl = arg("runUrl");
  const apply = process.argv.includes("--apply");
  const readback = verify(before, after, expectedProductGid, expectedAlt);
  const verified = readback.stableFieldsMatch && readback.imageChanged && readback.productGidUnchanged &&
    readback.expectedImagePresent && readback.actualImageCount === readback.expectedImageCount;
  if (!verified) throw new Error(`Read-only reconciliation did not verify: ${JSON.stringify(readback)}.`);

  const databaseUrl = String(process.env.DATABASE_URL_DIRECT ?? process.env.STAGING_DATABASE_URL_DIRECT ?? process.env.DATABASE_URL ?? "").trim();
  if (!databaseUrl) throw new Error("DATABASE_URL_DIRECT or STAGING_DATABASE_URL_DIRECT is required.");
  const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  try {
    const submission = await prisma.connectorSubmission.findFirst({
      where: { id: submissionId, tenantKey: tenant, installationId: installation, productId: product },
      select: { id: true, status: true, attemptNumber: true, payloadSnapshot: true },
    });
    if (!submission) throw new Error("Authorized submission was not found for the exact tuple.");
    const snapshot = submission.payloadSnapshot && typeof submission.payloadSnapshot === "object" ? submission.payloadSnapshot : {};
    const audit = snapshot.__vnextMutationAudit;
    if (!audit || typeof audit !== "object") throw new Error("Submission is missing __vnextMutationAudit.");
    if (submission.status !== "ERROR" || submission.attemptNumber !== 1 || audit.failureCode !== "SHOPIFY_VNEXT_READBACK_MISMATCH" ||
      audit.mutationCount !== 1 || audit.externalProductGid !== expectedProductGid || audit.payloadChecksum !== expectedChecksum ||
      audit.approvedPayloadChecksum !== expectedChecksum) {
      throw new Error("Submission no longer matches the exact historical readback-mismatch record.");
    }
    const reconciliation = {
      status: "verified_after_provider_settlement",
      reconciledAt: new Date().toISOString(),
      reconciliationRunUrl: runUrl,
      originalTerminalStatus: submission.status,
      originalFailureCode: audit.failureCode,
      providerMutationOccurred: true,
      verification: readback,
    };
    const nextAudit = { ...audit, reconciliation };
    const result = { submissionId, apply, verified, reconciliation };
    if (!apply) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    const existing = await prisma.auditLog.findFirst({
      where: { tenantKey: tenant, action: "SHOPIFY_VNEXT_CONTROLLED_MUTATION_RECONCILED", resource: "ConnectorSubmission", resourceId: submissionId },
      select: { id: true },
    });
    if (!existing) {
      await prisma.$transaction([
        prisma.connectorSubmission.update({ where: { id: submissionId }, data: { payloadSnapshot: { ...snapshot, __vnextMutationAudit: nextAudit } } }),
        prisma.auditLog.create({ data: { id: crypto.randomUUID(), tenantKey: tenant, actorId: "system", actorRole: "system", action: "SHOPIFY_VNEXT_CONTROLLED_MUTATION_RECONCILED", resource: "ConnectorSubmission", resourceId: submissionId, metadata: nextAudit } }),
      ]);
    }
    console.log(JSON.stringify({ ...result, alreadyReconciled: Boolean(existing) }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
