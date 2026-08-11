import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

// TEMPORARY, gated by RUN_CONNECTOR_SNAPSHOT_PROBE_ONCE=true. Part of #483
// (TECH-STORAGE-BACKEND-MIGRATION-001) acceptance verification. There is no
// safe, credential-free HTTP path that exercises ConnectorSubmissionStorageService's
// write/presign/reject-unsigned behavior (it only fires from inside a real
// marketplace PUBLISH submission), so this probes the identical S3 operations
// that service performs — same bucket, same key convention, same presign call —
// against a clearly-marked non-tenant key, without touching any DB row.
// Remove this file and its call site in main.ts once #483's acceptance
// verification is complete.

const PROBE_TENANT_SEGMENT = "_acceptance-probe";
const SIGNED_URL_EXPIRY_SECONDS = 60;

export async function runConnectorSnapshotStorageProbeOnce(): Promise<void> {
  if (String(process.env.RUN_CONNECTOR_SNAPSHOT_PROBE_ONCE ?? "").trim().toLowerCase() !== "true") {
    return;
  }

  console.log("[connector-snapshot-probe] RUN_CONNECTOR_SNAPSHOT_PROBE_ONCE=true, starting");

  const accountId = String(process.env.R2_ACCOUNT_ID ?? "").trim();
  const endpoint = String(process.env.R2_ENDPOINT ?? "").trim() || `https://${accountId}.r2.cloudflarestorage.com`;
  const bucket = String(process.env.R2_PRIVATE_BUCKET_NAME ?? process.env.R2_BUCKET_NAME ?? "").trim();
  if (!bucket) {
    console.error("[connector-snapshot-probe] R2_PRIVATE_BUCKET_NAME missing, aborting");
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

  const jobId = `probe-${Date.now()}`;
  const filename = `${jobId}-payload.json`;
  const key = `connector-snapshots/${PROBE_TENANT_SEGMENT}/${filename}`;
  const body = JSON.stringify({ probe: true, jobId, note: "acceptance probe artifact, safe to delete" });

  const result = { write: false, read: false, unsignedRejected: false, bucket, key };

  try {
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: body,
        ContentType: "application/json; charset=utf-8",
      }),
    );
    result.write = true;
  } catch (error) {
    console.error("[connector-snapshot-probe] write failed:", error instanceof Error ? error.message : String(error));
    console.log("[connector-snapshot-probe] result:", JSON.stringify(result));
    return;
  }

  let accessUrl: string;
  try {
    accessUrl = await getSignedUrl(
      s3,
      new GetObjectCommand({ Bucket: bucket, Key: key, ResponseContentType: "application/json; charset=utf-8" }),
      { expiresIn: SIGNED_URL_EXPIRY_SECONDS },
    );
  } catch (error) {
    console.error("[connector-snapshot-probe] presign failed:", error instanceof Error ? error.message : String(error));
    console.log("[connector-snapshot-probe] result:", JSON.stringify(result));
    return;
  }

  try {
    const readRes = await fetch(accessUrl);
    const readBody = await readRes.text();
    result.read = readRes.status === 200 && readBody === body;
    if (!result.read) {
      console.error(`[connector-snapshot-probe] presigned read mismatch: status=${readRes.status}`);
    }
  } catch (error) {
    console.error("[connector-snapshot-probe] presigned read failed:", error instanceof Error ? error.message : String(error));
  }

  try {
    const unsigned = new URL(accessUrl);
    unsigned.search = "";
    const unsignedRes = await fetch(unsigned.toString());
    result.unsignedRejected = unsignedRes.status !== 200;
    if (!result.unsignedRejected) {
      console.error("[connector-snapshot-probe] unsigned request was NOT rejected — private bucket may be misconfigured");
    }
  } catch {
    // A network-level rejection also counts as "did not work" — i.e. rejected.
    result.unsignedRejected = true;
  }

  console.log("[connector-snapshot-probe] result:", JSON.stringify(result));
}
