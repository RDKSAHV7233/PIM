#!/usr/bin/env node
/* eslint-disable no-console */

const PLACEHOLDER_PATTERN = /^\[[A-Z0-9_/\-\s]+\]$/;

const FIELD_DEFINITIONS = [
  {
    key: "sku",
    flag: "sku",
    label: "SKU",
    requiredFor: "Product retrieval by SKU, duplicate SKU detection, and product identity matching.",
    critical: true,
  },
  {
    key: "productId",
    flag: "product-id",
    label: "Product ID",
    requiredFor: "Product retrieval by ID and product detail QA.",
    critical: true,
  },
  {
    key: "productUrl",
    flag: "product-url",
    label: "Product URL",
    requiredFor: "Public listing and internet reference verification.",
    critical: false,
  },
  {
    key: "channel",
    flag: "channel",
    label: "Channel/marketplace",
    requiredFor: "Channel-required fields, mapping, marketplace readiness, and rejection-risk checks.",
    critical: true,
  },
  {
    key: "locale",
    flag: "locale",
    label: "Locale/market",
    requiredFor: "Localized content, currency, unit, and market compliance checks.",
    critical: true,
  },
  {
    key: "brand",
    flag: "brand",
    label: "Brand",
    requiredFor: "Brand consistency and external reference checks.",
    critical: false,
  },
  {
    key: "category",
    flag: "category",
    label: "Category",
    requiredFor: "Taxonomy and category-required attribute validation.",
    critical: true,
  },
  {
    key: "sourcePim",
    flag: "source-pim",
    label: "Source PIM system",
    requiredFor: "Source-of-truth ownership and source-data issue routing.",
    critical: true,
  },
  {
    key: "connectors",
    flag: "connectors",
    label: "Connector/tool name(s)",
    requiredFor: "Connector retrieval, channel mapping, feed, and publish-readiness checks.",
    critical: true,
  },
  {
    key: "internetVerification",
    flag: "internet-verification",
    label: "Internet verification required",
    requiredFor: "External reference validation scope.",
    critical: true,
    allowedValues: ["yes", "no"],
  },
];

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      continue;
    }
    const [rawFlag, inlineValue] = token.slice(2).split("=", 2);
    const value = inlineValue ?? argv[index + 1];
    args[rawFlag] = value ?? "";
    if (inlineValue === undefined && argv[index + 1] && !argv[index + 1].startsWith("--")) {
      index += 1;
    }
  }
  return args;
}

function isPlaceholder(value) {
  const normalized = String(value ?? "").trim();
  return normalized.length === 0 || PLACEHOLDER_PATTERN.test(normalized) || normalized.toLowerCase() === "yes/no";
}

function normalizeValue(value) {
  return String(value ?? "").trim();
}

function evaluateField(definition, args) {
  const value = normalizeValue(args[definition.flag]);
  const missing = isPlaceholder(value);
  const normalizedForAllowed = value.toLowerCase();
  const allowedValueInvalid =
    !missing &&
    Array.isArray(definition.allowedValues) &&
    !definition.allowedValues.includes(normalizedForAllowed);

  if (missing) {
    return {
      ...definition,
      value,
      status: "Not Provided",
      blocksReview: definition.critical,
      impact: definition.critical
        ? `Blocks ${definition.requiredFor}`
        : `Limits ${definition.requiredFor}`,
    };
  }

  if (allowedValueInvalid) {
    return {
      ...definition,
      value,
      status: "Invalid",
      blocksReview: definition.critical,
      impact: `Expected one of: ${definition.allowedValues.join(", ")}.`,
    };
  }

  return {
    ...definition,
    value,
    status: "Provided",
    blocksReview: false,
    impact: "Ready for validation.",
  };
}

function buildValidationPlan(results) {
  const byKey = new Map(results.map((item) => [item.key, item]));
  const hasSkuOrProductId =
    byKey.get("sku")?.status === "Provided" || byKey.get("productId")?.status === "Provided";
  const channelReady =
    byKey.get("channel")?.status === "Provided" &&
    byKey.get("connectors")?.status === "Provided" &&
    byKey.get("category")?.status === "Provided";
  const localeReady = byKey.get("locale")?.status === "Provided";
  const internetStatus = byKey.get("internetVerification")?.value.toLowerCase();
  const internetReady = internetStatus === "no" || byKey.get("productUrl")?.status === "Provided";

  return [
    {
      area: "Product retrieval",
      status: hasSkuOrProductId ? "Ready" : "Blocked",
      validation: "Retrieve product by SKU and/or Product ID; confirm exactly one matching record.",
    },
    {
      area: "Source data QA",
      status: hasSkuOrProductId ? "Ready" : "Blocked",
      validation: "Validate identity, content, attributes, media, relationships, commerce, and governance fields.",
    },
    {
      area: "Connector and channel readiness",
      status: hasSkuOrProductId && channelReady ? "Ready" : "Blocked",
      validation: "Run connector definitions, installed connector, mapping preflight, simulation, and publish-readiness checks.",
    },
    {
      area: "Locale and market readiness",
      status: hasSkuOrProductId && localeReady ? "Ready" : "Blocked",
      validation: "Validate localized title, descriptions, attributes, currency, units, and market compliance.",
    },
    {
      area: "Internet verification",
      status: internetReady ? "Ready" : "Blocked",
      validation: "Compare public listing or brand/manufacturer references without treating public data as automatically authoritative.",
    },
  ];
}

function printMarkdown(results, plan) {
  const blockers = results.filter((item) => item.blocksReview);
  const overall = blockers.length > 0 ? "Blocked" : "Ready";
  console.log(`# PIM Product QA Input Gate`);
  console.log("");
  console.log(`Overall result: ${overall}`);
  console.log("");
  console.log("| Input | Value | Status | Impact |");
  console.log("|---|---|---|---|");
  for (const item of results) {
    const value = item.value || "Not Provided";
    console.log(`| ${item.label} | ${value} | ${item.status} | ${item.impact} |`);
  }
  console.log("");
  console.log("| Review Area | Status | Validation |");
  console.log("|---|---|---|");
  for (const item of plan) {
    console.log(`| ${item.area} | ${item.status} | ${item.validation} |`);
  }
  console.log("");
  if (blockers.length > 0) {
    console.log("Required before PO approval:");
    for (const item of blockers) {
      console.log(`- Provide ${item.label}.`);
    }
  } else {
    console.log("Input gate passed. Proceed to connector retrieval and full product QA.");
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const results = FIELD_DEFINITIONS.map((definition) => evaluateField(definition, args));
  const plan = buildValidationPlan(results);
  const format = normalizeValue(args.format || "markdown").toLowerCase();
  const blockers = results.filter((item) => item.blocksReview);

  if (format === "json") {
    console.log(JSON.stringify({ status: blockers.length > 0 ? "Blocked" : "Ready", inputs: results, plan }, null, 2));
  } else {
    printMarkdown(results, plan);
  }

  process.exitCode = blockers.length > 0 ? 1 : 0;
}

main();
