#!/usr/bin/env node
/* eslint-disable no-console */
const { PrismaClient } = require("@prisma/client");

function toPositiveInt(value, fallback) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

function parseTenantArg(argv) {
  const index = argv.indexOf("--tenant");
  if (index === -1) {
    return null;
  }
  const candidate = argv[index + 1];
  if (!candidate || candidate.startsWith("--")) {
    throw new Error("Missing value for --tenant");
  }
  return candidate.trim();
}

async function run() {
  const redactDays = toPositiveInt(process.env.DATA_RETENTION_DAYS_REDACT_PAYLOAD, 90);
  const purgeDays = toPositiveInt(process.env.DATA_RETENTION_DAYS_PURGE_PAYLOAD, 365);
  const tenantKey = parseTenantArg(process.argv);

  const redactCutoff = new Date(Date.now() - redactDays * 24 * 60 * 60 * 1000);
  const purgeCutoff = new Date(Date.now() - purgeDays * 24 * 60 * 60 * 1000);

  const prisma = new PrismaClient({
    datasources: {
      db: {
        url: process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL,
      },
    },
  });

  try {
    let submissionRedacted;
    let webhookRedacted;
    let submissionPurged;
    let webhookPurged;

    if (tenantKey) {
      // RLS-BYPASS: manual tenant filter
      submissionRedacted = await prisma.$executeRawUnsafe(
        `
        UPDATE connector_submissions
        SET
          payload_snapshot = jsonb_build_object(
            'redacted', true,
            'redactedAt', NOW(),
            'policy', 'DG-001'
          ),
          payload_snapshot_url = NULL
        WHERE tenant_key = $1
          AND submitted_at < $2
          AND (payload_snapshot->>'redacted') IS DISTINCT FROM 'true'
        `,
        tenantKey,
        redactCutoff,
      );

      // RLS-BYPASS: manual tenant filter
      webhookRedacted = await prisma.$executeRawUnsafe(
        `
        UPDATE connector_webhook_events
        SET payload = jsonb_build_object(
          'redacted', true,
          'redactedAt', NOW(),
          'policy', 'DG-001'
        )
        WHERE tenant_key = $1
          AND received_at < $2
          AND (payload->>'redacted') IS DISTINCT FROM 'true'
        `,
        tenantKey,
        redactCutoff,
      );

      // RLS-BYPASS: manual tenant filter
      submissionPurged = await prisma.$executeRawUnsafe(
        `
        DELETE FROM connector_submissions
        WHERE tenant_key = $1
          AND submitted_at < $2
        `,
        tenantKey,
        purgeCutoff,
      );

      // RLS-BYPASS: manual tenant filter
      webhookPurged = await prisma.$executeRawUnsafe(
        `
        DELETE FROM connector_webhook_events
        WHERE tenant_key = $1
          AND received_at < $2
        `,
        tenantKey,
        purgeCutoff,
      );
    } else {
      // RLS-BYPASS: manual tenant filter
      submissionRedacted = await prisma.$executeRawUnsafe(
        `
        UPDATE connector_submissions
        SET
          payload_snapshot = jsonb_build_object(
            'redacted', true,
            'redactedAt', NOW(),
            'policy', 'DG-001'
          ),
          payload_snapshot_url = NULL
        WHERE submitted_at < $1
          AND (payload_snapshot->>'redacted') IS DISTINCT FROM 'true'
        `,
        redactCutoff,
      );

      // RLS-BYPASS: manual tenant filter
      webhookRedacted = await prisma.$executeRawUnsafe(
        `
        UPDATE connector_webhook_events
        SET payload = jsonb_build_object(
          'redacted', true,
          'redactedAt', NOW(),
          'policy', 'DG-001'
        )
        WHERE received_at < $1
          AND (payload->>'redacted') IS DISTINCT FROM 'true'
        `,
        redactCutoff,
      );

      // RLS-BYPASS: manual tenant filter
      submissionPurged = await prisma.$executeRawUnsafe(
        `
        DELETE FROM connector_submissions
        WHERE submitted_at < $1
        `,
        purgeCutoff,
      );

      // RLS-BYPASS: manual tenant filter
      webhookPurged = await prisma.$executeRawUnsafe(
        `
        DELETE FROM connector_webhook_events
        WHERE received_at < $1
        `,
        purgeCutoff,
      );
    }

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantKey: tenantKey ?? "ALL",
          policy: {
            redactAfterDays: redactDays,
            purgeAfterDays: purgeDays,
          },
          affected: {
            submissionRedacted: Number(submissionRedacted ?? 0),
            webhookRedacted: Number(webhookRedacted ?? 0),
            submissionPurged: Number(submissionPurged ?? 0),
            webhookPurged: Number(webhookPurged ?? 0),
          },
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

run().catch((error) => {
  console.error("Payload governance enforcement failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
