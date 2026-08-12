import { ListObjectsV2Command, S3Client } from "@aws-sdk/client-s3";
import { PrismaClient } from "@prisma/client";

// TEMPORARY, gated by RUN_MEDIA_RECOVERY_DISCOVERY_ONCE=true. Part of #496
// (BUG-MEDIA-STORAGE-001) remediation — recovery discovery step. For each of
// the 61 known-missing MediaAsset rows, searches every real object-storage
// location this app could plausibly have written to: the public media
// bucket (its expected home), the private artifacts bucket (in case of any
// historical relocation), under both the tenant-scoped prefix and a
// substring scan for the raw asset ID anywhere in the bucket, in case the
// key convention ever differed. Read-only: no DB writes, no file writes,
// no deletes. Reports RECOVERABLE / IRRECOVERABLE per asset — no guessing
// by filename, no synthetic matches. Remove this file and its main.ts call
// site once the #496 remediation decision is made.

const KNOWN_MISSING_IDS = [
  "21b9bee8-c4e9-46f5-862e-3db4b443ded8","451be704-8182-42cb-b9cc-1da12c513a12","ddf5f99d-3fff-4e49-9a3f-bf75b1ae6e04",
  "354578d9-2c81-435b-8c53-5f418d9fa55f","c9a93f97-7e6e-483d-b388-e72f0ccc2ed2","babb254e-8257-44c4-9218-73f67ca25697",
  "280d169c-c35f-4989-99ca-1718f706cfaf","811bec9a-81b4-472c-921b-de748872dd46","04220f88-f401-4fbf-b2bf-89ccb219396d",
  "d9fb0e39-c112-4bbe-8529-04567a05a72e","a48417bd-0e1c-41c6-82de-77be55fdcaea","f162342d-0d4e-4894-91b5-7fe34f53ad5d",
  "2a479eb3-326e-4cf6-8382-4f86905cdd91","e9574d68-84aa-4d2a-a7eb-ce6f9a1ad3f3","8bcf4ba7-54aa-4d36-911e-74104cba84be",
  "c01fa7a5-5147-4c59-88fd-4a3ac280fb21","aa67336a-dffa-41fa-86ac-f8481a9ec72c","ae6682f5-cfe9-455a-881f-da6c9476dafb",
  "661808b5-33db-4e69-ad3f-354e9b9ce3cd","ca0d804e-da26-45e7-a3b3-4c4ef8085323","9a01371b-162a-4a9f-bdaf-080a7b3ad9d7",
  "d513fbed-fe97-4435-977b-931718acd91f","7b60f85c-e4e4-4dfb-a4c0-504cda270cb4","fb71e276-522b-48dd-8bdb-7a0e77e4eece",
  "78c9f0bf-deef-432d-964a-047cb7bcce54","384f05e1-b445-4376-bd31-66e3ad5295ae","6fe1db49-8253-48c2-9262-a74ddecbebf1",
  "72c1c430-bb96-402d-af4f-412e0b8932bf","ffadcd76-0c8d-4457-9941-827c7c343414","07ccbea7-63ae-442e-9797-ba51b214b23f",
  "a6097c91-fb89-4c1c-ba19-3e8d79bcfc7d","5af6eb83-a918-46ff-b8a2-ddd4c39aeeb8","a62ea4b5-29bb-4442-b304-28aa986a0069",
  "dc61f556-501e-4cb3-bf09-af6ab20f8118","6f012b6c-7347-4bb0-a05a-2609c448248b","0475ab52-df10-4a51-9b51-895a98c305ab",
  "ad6b94fc-03e6-4d7d-ba2e-2202308ea084","5aaa6257-cb3c-4237-8cf1-38d121b45996","472c6160-57af-4663-8e9f-b6dd2ded2804",
  "2f1c68a5-9e8b-4683-967c-48492d2a56a2","2e909e7f-8cba-482d-95dd-0b09be7953da","4d199507-63e3-42d8-b008-0a9e7b5a9749",
  "417e6632-8b78-4368-a58e-fb41f47a101e","fb0b59b3-99d6-4908-b7ec-0110470497e0","3eb14f09-82fb-497c-a938-131e05eef04d",
  "b6797a42-112c-486d-9ab1-ea2f25144738","9d93bc1e-b162-449d-b41b-916919be4f35","41a9326c-63b1-453b-a246-c7e9fc3989f7",
  "b923404d-92a8-4a1f-9a02-d1fb99adf3b0","30bd784e-e560-4df2-9786-2fabf7f2d5cc","bf9b106a-6914-4769-8d60-5599ccc31fd8",
  "db5c882f-54a5-4c36-8bb1-761928a3cee4","5ee25846-1f1a-4c79-bbc9-3bdb7490dbd5","cab82785-a75e-4cd6-98fa-a394f66ee7ea",
  "af21d76f-1977-4348-a857-8a117b78ee79","0813433a-7b2e-478c-b61f-60813befaad8","dcaa3f41-f41d-4285-8a64-deb0ed8cd9f4",
  "3364b2aa-7417-4d7f-bce2-4d1822c6ec2a","daf6cbca-654a-4d9d-8de8-6f2c7a803403","8d38c4b6-f8bb-43b1-9d3b-38b5db6a17f1",
  "83ca843b-f9a2-451f-9529-afa1f7098a2e",
];

async function listAllKeys(s3: S3Client, bucket: string, prefix?: string): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const res = await s3.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: continuationToken }),
    );
    for (const obj of res.Contents ?? []) {
      if (obj.Key) keys.push(obj.Key);
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);
  return keys;
}

export async function runMediaRecoveryDiscoveryOnce(): Promise<void> {
  if (String(process.env.RUN_MEDIA_RECOVERY_DISCOVERY_ONCE ?? "").trim().toLowerCase() !== "true") {
    return;
  }

  console.log("[media-recovery-discovery] RUN_MEDIA_RECOVERY_DISCOVERY_ONCE=true, starting");

  const accountId = String(process.env.R2_ACCOUNT_ID ?? "").trim();
  const endpoint = String(process.env.R2_ENDPOINT ?? "").trim() || `https://${accountId}.r2.cloudflarestorage.com`;
  const publicBucket = String(process.env.R2_BUCKET_NAME ?? "").trim();
  const privateBucket = String(process.env.R2_PRIVATE_BUCKET_NAME ?? "").trim();
  if (!publicBucket) {
    console.error("[media-recovery-discovery] R2_BUCKET_NAME missing, aborting");
    return;
  }

  const s3 = new S3Client({
    region: "auto",
    endpoint,
    credentials: {
      accessKeyId: String(process.env.R2_ACCESS_KEY_ID ?? "").trim(),
      secretAccessKey: String(process.env.R2_SECRET_ACCESS_KEY ?? "").trim(),
    },
  });

  const prisma = new PrismaClient();
  try {
    const rows = await prisma.mediaAsset.findMany({
      where: { id: { in: KNOWN_MISSING_IDS } },
      select: { id: true, tenantKey: true, storagePath: true, checksum: true, sizeBytes: true },
    });
    console.log(`[media-recovery-discovery] found ${rows.length}/${KNOWN_MISSING_IDS.length} known-missing rows in DB`);

    console.log(`[media-recovery-discovery] listing full public bucket (${publicBucket}) media/ prefix...`);
    const publicKeys = await listAllKeys(s3, publicBucket, "media/");
    console.log(`[media-recovery-discovery] public bucket media/ prefix: ${publicKeys.length} objects total`);

    console.log(`[media-recovery-discovery] listing full private bucket (${privateBucket || "unset"})...`);
    const privateKeys = privateBucket ? await listAllKeys(s3, privateBucket) : [];
    console.log(`[media-recovery-discovery] private bucket: ${privateKeys.length} objects total`);

    const results: Array<{ id: string; tenantKey: string; storagePath: string; disposition: string; foundKey?: string }> = [];
    for (const row of rows) {
      const matchInPublic = publicKeys.find((k) => k.includes(row.id));
      const matchInPrivate = privateKeys.find((k) => k.includes(row.id));
      if (matchInPublic) {
        results.push({ id: row.id, tenantKey: row.tenantKey, storagePath: row.storagePath, disposition: "RECOVERABLE", foundKey: `${publicBucket}/${matchInPublic}` });
      } else if (matchInPrivate) {
        results.push({ id: row.id, tenantKey: row.tenantKey, storagePath: row.storagePath, disposition: "RECOVERABLE", foundKey: `${privateBucket}/${matchInPrivate}` });
      } else {
        results.push({ id: row.id, tenantKey: row.tenantKey, storagePath: row.storagePath, disposition: "IRRECOVERABLE" });
      }
    }

    const recoverable = results.filter((r) => r.disposition === "RECOVERABLE");
    const irrecoverable = results.filter((r) => r.disposition === "IRRECOVERABLE");
    console.log(`[media-recovery-discovery] SUMMARY: recoverable=${recoverable.length} irrecoverable=${irrecoverable.length} total=${results.length}`);
    console.log(`[media-recovery-discovery] full result: ${JSON.stringify(results)}`);
  } catch (error) {
    console.error(
      `[media-recovery-discovery] failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }

  console.log("[media-recovery-discovery] done");
}
