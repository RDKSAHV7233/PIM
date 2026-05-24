#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const NOTIFICATIONS_SERVICE = path.join(
  REPO_ROOT,
  "apps",
  "api",
  "src",
  "notifications",
  "notifications.service.ts",
);
const CATALOG_SERVICE = path.join(
  REPO_ROOT,
  "apps",
  "api",
  "src",
  "catalog",
  "catalog.service.ts",
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const notificationsSource = fs.readFileSync(NOTIFICATIONS_SERVICE, "utf8");
  const catalogSource = fs.readFileSync(CATALOG_SERVICE, "utf8");
  const retargetCallCount = (catalogSource.match(/await this\.notificationsService\.retargetProductNotifications\(productId\);/g) ?? []).length;

  assert(
    notificationsSource.includes('const PRODUCT_NOTIFICATION_FALLBACK_URL = "/catalog/products";') &&
      notificationsSource.includes('const PRODUCT_NOTIFICATION_FALLBACK_LABEL = "View products";'),
    "notifications service must define the safe catalog fallback for deleted product links.",
  );
  assert(
    notificationsSource.includes("async retargetProductNotifications(productId: string)") &&
      notificationsSource.includes('path: ["productId"]') &&
      notificationsSource.includes("startsWith: productDetailPrefix"),
    "notifications service must retarget product-linked notifications by metadata and actionUrl prefix.",
  );
  assert(
    notificationsSource.includes("actionUrl: PRODUCT_NOTIFICATION_FALLBACK_URL") &&
      notificationsSource.includes("actionLabel: PRODUCT_NOTIFICATION_FALLBACK_LABEL"),
    "retargeted notifications must point to the products list with a safe label.",
  );
  assert(
    retargetCallCount >= 2,
    "catalog service must retarget product-linked notifications in both delete and purge flows.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "notifications_service_retargets_deleted_product_links",
          "catalog_delete_and_purge_call_notification_retarget",
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

try {
  run();
} catch (error) {
  console.error("Notifications product-link retarget source test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
