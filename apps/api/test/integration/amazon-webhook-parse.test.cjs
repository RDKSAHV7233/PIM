#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const { createHmac } = require("node:crypto");

const REPO_ROOT = path.resolve(__dirname, "../../../..");

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || /^\s*#/.test(line)) {
      continue;
    }
    const index = line.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^"|"$/g, "");
    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
}

function setDefaultEnv(name, value) {
  if (!process.env[name] || String(process.env[name]).trim().length === 0) {
    process.env[name] = value;
  }
}

function prepareEnv() {
  readEnvFile(path.join(REPO_ROOT, ".env"));
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_V1", "vexa-pim-local-encryption-key-v1-minimum-32");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION", "1");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sign(secret, timestamp, body) {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

async function run() {
  prepareEnv();

  const { AmazonConnector } = require(path.join(
    REPO_ROOT,
    "apps",
    "api",
    "dist",
    "connectors",
    "amazon",
    "amazon.connector.js",
  ));
  const { PrismaDirectService } = require(path.join(
    REPO_ROOT,
    "apps",
    "api",
    "dist",
    "prisma",
    "prisma-direct.service.js",
  ));
  const { LoggerService } = require(path.join(
    REPO_ROOT,
    "apps",
    "api",
    "dist",
    "common",
    "logging",
    "logger.service.js",
  ));

  const previousSecret = process.env.PIM_AMAZON_WEBHOOK_SECRET;
  process.env.PIM_AMAZON_WEBHOOK_SECRET = "amazon-webhook-test-secret";

  try {
    const connector = new AmazonConnector(new PrismaDirectService(), new LoggerService());

    const timestamp = new Date().toISOString();
    const statusEnvelope = {
      NotificationType: "LISTINGS_ITEM_STATUS_CHANGE",
      NotificationMetadata: {
        NotificationId: "evt-status-1",
      },
      Payload: {
        SellerId: "seller-1",
        MarketplaceId: "A21TJRUUN4KGV",
        Sku: "AMZ-SKU-1",
        Status: ["DISCOVERABLE", "BUYABLE"],
      },
    };
    const statusBody = JSON.stringify(statusEnvelope);
    const parsedStatus = await connector.parseWebhookEvent(Buffer.from(statusBody, "utf8"), {
      "x-pim1-webhook-timestamp": timestamp,
      "x-pim1-webhook-signature": sign(process.env.PIM_AMAZON_WEBHOOK_SECRET, timestamp, statusBody),
    });

    assert(parsedStatus, "expected signed Amazon status notification to parse");
    assert(parsedStatus.eventType === "LISTINGS_ITEM_STATUS_CHANGE", `unexpected event type ${parsedStatus.eventType}`);
    assert(parsedStatus.rawEventId === "evt-status-1", `unexpected rawEventId ${parsedStatus.rawEventId}`);
    assert(parsedStatus.productSku === "AMZ-SKU-1", `unexpected productSku ${parsedStatus.productSku}`);
    assert(parsedStatus.status === "SUCCESS", `expected SUCCESS status, got ${String(parsedStatus.status)}`);
    assert(Array.isArray(parsedStatus.channelErrors) && parsedStatus.channelErrors.length === 0, "expected no status-change issues");

    const issueEnvelope = {
      detail: {
        NotificationType: "LISTINGS_ITEM_ISSUES_CHANGE",
        NotificationMetadata: {
          NotificationId: "evt-issues-1",
        },
        Payload: {
          SellerId: "seller-1",
          MarketplaceId: "A21TJRUUN4KGV",
          Sku: "AMZ-SKU-2",
          Severities: ["ERROR"],
          EnforcementActions: ["LISTING_SUPPRESSED"],
        },
      },
    };
    const issueBody = JSON.stringify(issueEnvelope);
    const parsedIssue = await connector.parseWebhookEvent(Buffer.from(issueBody, "utf8"), {
      "X-PIM1-Webhook-Timestamp": timestamp,
      "X-PIM1-Webhook-Signature": sign(process.env.PIM_AMAZON_WEBHOOK_SECRET, timestamp, issueBody),
    });

    assert(parsedIssue, "expected signed Amazon issues notification to parse");
    assert(parsedIssue.eventType === "LISTINGS_ITEM_ISSUES_CHANGE", `unexpected issue event type ${parsedIssue.eventType}`);
    assert(parsedIssue.rawEventId === "evt-issues-1", `unexpected issue rawEventId ${parsedIssue.rawEventId}`);
    assert(parsedIssue.productSku === "AMZ-SKU-2", `unexpected issue productSku ${parsedIssue.productSku}`);
    assert(parsedIssue.status === "SUPPRESSED", `expected SUPPRESSED issue status, got ${String(parsedIssue.status)}`);
    assert(Array.isArray(parsedIssue.channelErrors) && parsedIssue.channelErrors.length === 1, `expected one issue error, got ${JSON.stringify(parsedIssue.channelErrors)}`);
    assert(parsedIssue.channelErrors[0].code === "LISTING_SUPPRESSED", `unexpected issue code ${parsedIssue.channelErrors[0].code}`);
    assert(parsedIssue.channelErrors[0].sellerMessage === "Amazon suppressed this listing from purchase.", `unexpected issue message ${parsedIssue.channelErrors[0].sellerMessage}`);
    assert(parsedIssue.channelErrors[0].severity === "error", `unexpected issue severity ${parsedIssue.channelErrors[0].severity}`);

    const invalid = await connector.parseWebhookEvent(Buffer.from(statusBody, "utf8"), {
      "x-pim1-webhook-timestamp": timestamp,
      "x-pim1-webhook-signature": "sha256=invalid",
    });
    assert(invalid === null, "expected invalid signature to be rejected");

    console.log(
      JSON.stringify(
        {
          status: "ok",
          validated: [
            "amazon_signed_status_notification_parses_to_success",
            "amazon_signed_issue_notification_parses_to_suppressed_with_normalized_issue",
            "amazon_invalid_signature_is_rejected",
          ],
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } finally {
    if (previousSecret === undefined) {
      delete process.env.PIM_AMAZON_WEBHOOK_SECRET;
    } else {
      process.env.PIM_AMAZON_WEBHOOK_SECRET = previousSecret;
    }
  }
}

run().catch((error) => {
  console.error("Amazon webhook parse integration test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
