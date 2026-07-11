#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const { PrismaClient } = require("@prisma/client");
const { buildPack, DATASET_ID, GENERATED_DIR } = require("./lib/realistic-qa-pack.cjs");
const {
  buildCategoryOwnership,
  getCategoryOwnership,
  getDatasetProductWhere,
  hasExplicitCategoryOwnership,
  normalizeSeedOptions,
  sortCategoriesForDeletion,
} = require("./lib/realistic-qa-pack-runtime.cjs");

const RUNTIME_MANIFEST_PATH = path.join(GENERATED_DIR, "runtime-manifest.json");
const DEFAULT_PASSWORD = process.env.PLAYWRIGHT_PASSWORD || "vexa-pim-demo-password";

const ROLE_IDENTITIES = {
  admin: process.env.PLAYWRIGHT_ADMIN_USER || "admin@vexa-pim.local",
  editor: process.env.PLAYWRIGHT_EDITOR_USER || "editor@vexa-pim.local",
  publisher: process.env.PLAYWRIGHT_PUBLISHER_USER || "publisher@vexa-pim.local",
  approver: process.env.PLAYWRIGHT_APPROVER_USER || "approver@vexa-pim.local",
  channel_manager: process.env.PLAYWRIGHT_CHANNEL_MANAGER_USER || "channel_manager@vexa-pim.local",
  connector_admin: process.env.PLAYWRIGHT_CONNECTOR_ADMIN_USER || "connector_admin@vexa-pim.local",
  reviewer: process.env.PLAYWRIGHT_REVIEWER_USER || "reviewer@vexa-pim.local",
  viewer: process.env.PLAYWRIGHT_VIEWER_USER || "viewer@vexa-pim.local",
};

function ensureDir(targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
}

function runtimeManifestPathFromArgs(manifestPath) {
  return manifestPath ? path.resolve(process.cwd(), String(manifestPath)) : RUNTIME_MANIFEST_PATH;
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function readRuntimeManifest(runtimeManifestPath) {
  if (!fs.existsSync(runtimeManifestPath)) {
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(runtimeManifestPath, "utf8"));
  } catch {
    return null;
  }
}

async function upsertWorkspaceAndUsers(prisma, tenantKey) {
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 12);

  await prisma.workspaceDirectory.upsert({
    where: { tenantKey },
    create: {
      tenantKey,
      workspaceSlug: tenantKey,
      displayName: "Default",
      isActive: true,
    },
    update: {
      workspaceSlug: tenantKey,
      displayName: "Default",
      isActive: true,
    },
  });

  await prisma.tenantPlanProfile.upsert({
    where: { tenantKey },
    create: {
      tenantKey,
      planTier: "ENTERPRISE",
      billingStatus: "active_paid",
      accessStatus: "active",
      effectiveFrom: new Date(),
      updatedBy: "realistic-qa-pack-db",
    },
    update: {
      planTier: "ENTERPRISE",
      billingStatus: "active_paid",
      accessStatus: "active",
      effectiveFrom: new Date(),
      updatedBy: "realistic-qa-pack-db",
    },
  });

  await prisma.workflowSla.upsert({
    where: { tenantKey },
    create: { tenantKey, reviewTargetDays: 3 },
    update: { reviewTargetDays: 3 },
  });

  for (const [role, userId] of Object.entries(ROLE_IDENTITIES)) {
    await prisma.authIdentity.upsert({
      where: { userId },
      create: {
        tenantKey,
        userId,
        role,
        assignedRoles: [],
        isActive: true,
        passwordHash,
        createdBy: "realistic-qa-pack-db",
      },
      update: {
        tenantKey,
        role,
        isActive: true,
        passwordHash,
      },
    });
  }
}

async function maybeSeedControlPlane(prisma, tenantKey, options) {
  if (!options.allowControlPlaneMutations) {
    return { applied: false };
  }

  await upsertWorkspaceAndUsers(prisma, tenantKey);
  return { applied: true };
}

async function ensureTaxRegimes(prisma) {
  const regimes = [
    { marketCode: "IN", name: "India GST", description: "India GST regime" },
    { marketCode: "GB", name: "UK VAT", description: "UK VAT regime" },
    { marketCode: "AE", name: "UAE VAT", description: "UAE VAT regime" },
    { marketCode: "US", name: "US Sales Tax", description: "US sales tax regime" },
    { marketCode: "AU", name: "Australia GST", description: "Australia GST regime" },
  ];

  for (const regime of regimes) {
    await prisma.taxRegime.upsert({
      where: { marketCode: regime.marketCode },
      create: regime,
      update: regime,
    });
  }

  const rows = await prisma.taxRegime.findMany({ where: { marketCode: { in: regimes.map((item) => item.marketCode) } } });
  return new Map(rows.map((row) => [row.marketCode, row]));
}

async function cleanupExistingDataset(prisma, tenantKey, runtimeManifestPath) {
  const runtimeManifest = readRuntimeManifest(runtimeManifestPath);
  const datasetInstallations = await prisma.connectorInstallation.findMany({
    where: {
      tenantKey,
      metadata: { path: ["datasetId"], equals: DATASET_ID },
    },
    select: { id: true },
  });
  const datasetInstallationIds = datasetInstallations.map((item) => item.id);

  if (datasetInstallationIds.length > 0) {
    await prisma.connectorCredential.deleteMany({ where: { tenantKey, installationId: { in: datasetInstallationIds } } });
    await prisma.connectorSubmission.deleteMany({ where: { tenantKey, installationId: { in: datasetInstallationIds } } });
    await prisma.connectorProductSyncState.deleteMany({ where: { tenantKey, installationId: { in: datasetInstallationIds } } });
    await prisma.connectorSyncSchedule.deleteMany({ where: { tenantKey, installationId: { in: datasetInstallationIds } } });
    await prisma.connectorProductLink.deleteMany({ where: { tenantKey, installationId: { in: datasetInstallationIds } } });
    await prisma.connectorInstallation.deleteMany({ where: { tenantKey, id: { in: datasetInstallationIds } } });
  }

  await prisma.connectorMappingVersion.deleteMany({
    where: {
      tenantKey,
      fallbackPolicy: { path: ["datasetId"], equals: DATASET_ID },
    },
  });
  await prisma.bulkEditOperation.deleteMany({
    where: {
      tenantKey,
      scope: { path: ["datasetId"], equals: DATASET_ID },
    },
  });
  const bulkEditIds = Array.isArray(runtimeManifest?.ops?.bulkEdit?.operationIds) ? runtimeManifest.ops.bulkEdit.operationIds : [];
  const importJobIds = Array.isArray(runtimeManifest?.ops?.importJob?.jobIds) ? runtimeManifest.ops.importJob.jobIds : [];
  const installationIds = Array.isArray(runtimeManifest?.connectors?.installationIds) ? runtimeManifest.connectors.installationIds : [];
  const mappingIds = Array.isArray(runtimeManifest?.connectors?.mappingVersionIds) ? runtimeManifest.connectors.mappingVersionIds : [];
  const createdAttributeDefinitionIds = Array.isArray(runtimeManifest?.createdAttributeDefinitionIds)
    ? runtimeManifest.createdAttributeDefinitionIds
    : Array.isArray(runtimeManifest?.createdAttributeDefinitions)
      ? runtimeManifest.createdAttributeDefinitions.map((definition) => definition.id).filter(Boolean)
      : [];

  const existingProducts = await prisma.product.findMany({
    where: getDatasetProductWhere(tenantKey, DATASET_ID),
    select: { id: true, title: true },
  });
  const productIds = existingProducts.map((item) => item.id);

  if (productIds.length > 0) {
    await prisma.userNotification.deleteMany({
      where: {
        tenantKey,
        OR: [
          { actionUrl: { in: productIds.map((id) => `/products/${id}`) } },
          { metadata: { path: ["datasetId"], equals: DATASET_ID } },
        ],
      },
    });
    await prisma.approvalComment.deleteMany({ where: { tenantKey, productId: { in: productIds } } });
    await prisma.auditLog.deleteMany({ where: { tenantKey, resourceId: { in: productIds } } });
    await prisma.connectorSubmission.deleteMany({ where: { tenantKey, productId: { in: productIds } } });
    await prisma.mediaAsset.deleteMany({ where: { tenantKey, productId: { in: productIds } } });
    await prisma.bulkEditOperationItem.deleteMany({ where: { tenantKey, productId: { in: productIds } } });
    await prisma.marketplaceExportJob.deleteMany({ where: { tenantKey, productId: { in: productIds } } });
    await prisma.product.deleteMany({ where: { tenantKey, id: { in: productIds } } });
  }

  if (bulkEditIds.length > 0) {
    await prisma.bulkEditOperation.deleteMany({ where: { tenantKey, id: { in: bulkEditIds } } });
  }
  if (importJobIds.length > 0) {
    await prisma.bulkImportJob.deleteMany({ where: { tenantKey, id: { in: importJobIds } } });
  }
  if (mappingIds.length > 0) {
    await prisma.connectorMappingVersion.deleteMany({ where: { tenantKey, id: { in: mappingIds } } });
  }
  if (installationIds.length > 0) {
    await prisma.connectorCredential.deleteMany({ where: { tenantKey, installationId: { in: installationIds } } });
    await prisma.connectorSubmission.deleteMany({ where: { tenantKey, installationId: { in: installationIds } } });
    await prisma.connectorProductSyncState.deleteMany({ where: { tenantKey, installationId: { in: installationIds } } });
    await prisma.connectorSyncSchedule.deleteMany({ where: { tenantKey, installationId: { in: installationIds } } });
    await prisma.connectorProductLink.deleteMany({ where: { tenantKey, installationId: { in: installationIds } } });
    await prisma.connectorInstallation.deleteMany({ where: { tenantKey, id: { in: installationIds } } });
  }

  if (createdAttributeDefinitionIds.length > 0) {
    await prisma.attributeDefinition.deleteMany({ where: { tenantKey, id: { in: createdAttributeDefinitionIds } } });
  }

  const ownership = getCategoryOwnership(runtimeManifest ?? {});
  const ownedCategories = hasExplicitCategoryOwnership(runtimeManifest ?? {})
    ? sortCategoriesForDeletion(ownership.createdCategories)
    : [];

  for (const category of ownedCategories) {
    await prisma.category.deleteMany({ where: { tenantKey, id: category.id } });
  }

  return {
    deletedProductIds: productIds,
    deletedCategoryIds: ownedCategories.map((category) => category.id),
    deletedAttributeDefinitionIds: createdAttributeDefinitionIds,
    skippedCategoryCleanup: !hasExplicitCategoryOwnership(runtimeManifest ?? {}),
  };
}

function buildStatusAuditEntries(productId, productDefinition, actorId) {
  const entries = [
    {
      id: randomId("audit"),
      tenantKey: "default",
      actorId,
      actorRole: "editor",
      action: "PRODUCT_CREATED",
      resource: "/api/v1/catalog/products",
      resourceId: productId,
      metadata: { datasetId: DATASET_ID, scenario: productDefinition.businessScenario },
    },
  ];

  if (productDefinition.status !== "draft") {
    entries.push({
      id: randomId("audit"),
      tenantKey: "default",
      actorId,
      actorRole: "editor",
      action: "STATUS_TRANSITION",
      resource: "/api/v1/catalog/products/:id",
      resourceId: productId,
      metadata: { fromStatus: "draft", toStatus: productDefinition.status, datasetId: DATASET_ID },
    });
  }

  return entries;
}

async function createOptionalOpsArtifacts({
  prisma,
  pack,
  tenantKey,
  seedOptions,
  categoryByKey,
  approvedProducts,
  bulkEditTargets,
}) {
  if (!seedOptions.withOps) {
    return {
      connectorInstallationId: null,
      mappingVersionIds: [],
      submissionIds: [],
      bulkEditOperationIds: [],
      importJobIds: [],
    };
  }

  const connectorDefinition = await prisma.connectorDefinition.upsert({
    where: { slug: "shopify" },
    create: {
      id: "qa-shopify-def",
      slug: "shopify",
      displayName: "Shopify",
      authType: "oauth2",
      capabilities: ["PUBLISH", "VALIDATE", "STATUS_SYNC", "WEBHOOK_RECEIVE"],
      connectorVersion: "1.0.0",
      isActive: true,
    },
    update: {
      displayName: "Shopify",
      authType: "oauth2",
      capabilities: ["PUBLISH", "VALIDATE", "STATUS_SYNC", "WEBHOOK_RECEIVE"],
      connectorVersion: "1.0.0",
      isActive: true,
    },
  });

  const connectorInstallationId = randomId("conn_install");
  await prisma.connectorInstallation.create({
    data: {
      id: connectorInstallationId,
      tenantKey,
      connectorId: connectorDefinition.id,
      accountAlias: "qa-primary",
      externalAccountRef: "shop.demo.default",
      status: "ACTIVE",
      metadata: { datasetId: DATASET_ID, storeName: "Demo Shopify Store", launchStage: "manual" },
      installedBy: ROLE_IDENTITIES.connector_admin,
    },
  });

  const mappingVersionIds = [];
  const mappingVersionId = randomId("mapver");
  mappingVersionIds.push(mappingVersionId);
  await prisma.connectorMappingVersion.create({
    data: {
      id: mappingVersionId,
      tenantKey,
      connectorSlug: "shopify",
      installationId: connectorInstallationId,
      categoryScope: categoryByKey.get("women-kurtas").path,
      mappingLevel: "tenant_connector_category_mapping",
      lifecycleState: "published",
      connectorDefinitionId: connectorDefinition.id,
      connectorDefinitionVersion: connectorDefinition.connectorVersion,
      compatibilityState: "compatible",
      mappingRules: {
        title: "title",
        brand: "brand",
        hsnCode: "hsnCode",
        gstRate: "gstRate",
        material: "attributes.material",
      },
      fallbackPolicy: { datasetId: DATASET_ID },
      fallbackAckRequired: false,
      publishedAt: new Date(),
      createdBy: ROLE_IDENTITIES.connector_admin,
    },
  });

  const submissionIds = [];
  if (approvedProducts.length >= 2) {
    const successSubmissionId = randomId("submission");
    const failedSubmissionId = randomId("submission");
    submissionIds.push(successSubmissionId, failedSubmissionId);
    await prisma.connectorSubmission.create({
      data: {
        id: successSubmissionId,
        tenantKey,
        installationId: connectorInstallationId,
        productId: approvedProducts[0].id,
        idempotencyKey: `${approvedProducts[0].id}:success`,
        submissionType: "publish",
        source: "LOCAL_RULES",
        status: "SUCCESS",
        externalRef: "shopify-prod-1001",
        payloadSnapshot: { datasetId: DATASET_ID, outcome: "success" },
      },
    });
    await prisma.connectorSubmission.create({
      data: {
        id: failedSubmissionId,
        tenantKey,
        installationId: connectorInstallationId,
        productId: approvedProducts[1].id,
        idempotencyKey: `${approvedProducts[1].id}:failed`,
        submissionType: "publish",
        source: "LOCAL_RULES",
        status: "ERROR",
        externalRef: null,
        payloadSnapshot: { datasetId: DATASET_ID, outcome: "failed" },
        channelErrors: [{ code: "payload_rejected", message: "Missing downstream mapping acknowledgement." }],
      },
    });
  }

  const bulkEditOperationIds = [];
  if (bulkEditTargets.length >= 2) {
    const operation = await prisma.bulkEditOperation.create({
      data: {
        tenantKey,
        status: "completed",
        scope: { productIds: bulkEditTargets.map((item) => item.id), datasetId: DATASET_ID },
        updates: { brand: "Vista Uniforms" },
        requestedCount: bulkEditTargets.length,
        appliedCount: bulkEditTargets.length,
        failedCount: 0,
      },
    });
    bulkEditOperationIds.push(operation.id);
    for (const product of bulkEditTargets) {
      await prisma.bulkEditOperationItem.create({
        data: {
          tenantKey,
          operationId: operation.id,
          productId: product.id,
          status: "success",
          before: { brand: product.brand },
          after: { brand: "Vista Uniforms" },
        },
      });
    }
  }

  const importJobIds = [];
  const womenKurtaCategory = categoryByKey.get("women-kurtas");
  const importJob = await prisma.bulkImportJob.create({
    data: {
      tenantKey,
      categoryId: womenKurtaCategory.id,
      sourceFormat: "csv",
      sourceName: "Visible QA Mixed Import",
      mapping: { title: "title", brand: "brand", skuCode: "skuCode" },
      chunkSize: 5,
      maxRetries: 1,
      status: "dead_letter",
      totalRows: pack.imports.mixedRows.length,
      processedRows: pack.imports.mixedRows.length,
      successRows: 4,
      failedRows: 4,
      deadLetterRows: 2,
    },
  });
  importJobIds.push(importJob.id);

  for (const [index, row] of pack.imports.mixedRows.entries()) {
    const status = index < 2 ? "success" : index < 8 ? "failed" : "dead_letter";
    await prisma.bulkImportRow.create({
      data: {
        tenantKey,
        jobId: importJob.id,
        rowNumber: index + 1,
        payload: row,
        status,
        retryCount: status === "dead_letter" ? 1 : 0,
        errorMessage:
          status === "success"
            ? null
            : index === 2
              ? "Duplicate skuCode detected in import payload."
              : index === 3
                ? "Missing required title and skuCode."
                : index === 4
                  ? "Category path not found."
                  : index === 5
                    ? "HSN must be 4, 6, or 8 digits."
                    : index === 6
                      ? "gstRate must be a number."
                      : index === 7
                        ? "skuCode is required."
                        : "WORKFLOW_ENTRY_INVALID",
      },
    });
  }

  await prisma.userNotification.create({
    data: {
      id: randomId("notif"),
      tenantKey,
      userId: ROLE_IDENTITIES.editor,
      eventType: "import_repair_required",
      title: "Import repair required",
      message: "Visible QA Mixed Import has rows that need repair.",
      actionUrl: `/operations/repair?jobId=${importJob.id}`,
      actionLabel: "Open repair center",
      metadata: { datasetId: DATASET_ID, jobId: importJob.id },
    },
  });

  return {
    connectorInstallationId,
    mappingVersionIds,
    submissionIds,
    bulkEditOperationIds,
    importJobIds,
  };
}

async function seedDirectQaPack(options = {}) {
  const pack = buildPack();
  const seedOptions = normalizeSeedOptions(options);
  const runtimeManifestPath = runtimeManifestPathFromArgs(options.runtimeManifestPath);
  const prisma = new PrismaClient();
  const tenantKey = pack.tenantKey;

  try {
    await prisma.$connect();
    const cleanupSummary = await cleanupExistingDataset(prisma, tenantKey, runtimeManifestPath);
    const controlPlane = await maybeSeedControlPlane(prisma, tenantKey, seedOptions);
    const taxRegimes = await ensureTaxRegimes(prisma);

    const categoryRows = [];
    const createdCategoryIds = [];
    const categoryByKey = new Map();
    for (const category of pack.taxonomy) {
      const existing = await prisma.category.findFirst({
        where: {
          tenantKey,
          path: category.path,
        },
      });
      const resolved =
        existing ??
        (await prisma.category.create({
          data: {
            tenantKey,
            name: category.name,
            slug: category.slug,
            path: category.path,
            parentId: category.parentKey ? categoryByKey.get(category.parentKey)?.id ?? null : null,
          },
        }));
      if (!existing) {
        createdCategoryIds.push(resolved.id);
      }
      categoryByKey.set(category.key, resolved);
      categoryRows.push({ key: category.key, id: resolved.id, path: resolved.path, name: resolved.name });
    }
    const categoryOwnership = buildCategoryOwnership(categoryRows, createdCategoryIds);

    const createdAttributeRows = [];
    for (const definition of pack.attributeDefinitions) {
      const category = categoryByKey.get(definition.categoryKey);
      const existing = await prisma.attributeDefinition.findFirst({
        where: {
          tenantKey,
          categoryId: category.id,
          key: definition.key,
          appliesTo: definition.appliesTo,
        },
      });
      const resolved =
        existing ??
        (await prisma.attributeDefinition.create({
          data: {
            tenantKey,
            categoryId: category.id,
            key: definition.key,
            name: definition.name,
            dataType: definition.dataType,
            required: definition.required,
            allowedValues: definition.allowedValues ?? {},
            appliesTo: definition.appliesTo,
          },
        }));
      if (!existing) {
        createdAttributeRows.push({ id: resolved.id, categoryId: resolved.categoryId, key: resolved.key, appliesTo: resolved.appliesTo });
      }
    }

    const createdProducts = [];
    const bulkEditTargets = [];
    const approvedProducts = [];
    for (const productDefinition of pack.products) {
      const category = categoryByKey.get(productDefinition.categoryKey);
      const createdProduct = await prisma.product.create({
        data: {
          tenantKey,
          title: productDefinition.title,
          description: productDefinition.description,
          brand: productDefinition.brand,
          status: productDefinition.status,
          categoryId: category.id,
          hsnCode: productDefinition.hsnCode ?? null,
          gstRate: productDefinition.gstRate ?? null,
          attributes: productDefinition.attributes,
        },
      });

      const variantRows = [];
      for (const variant of productDefinition.variants) {
        const createdVariant = await prisma.variant.create({
          data: {
            tenantKey,
            productId: createdProduct.id,
            skuCode: variant.skuCode,
            attributes: variant.attributes,
            mrp: variant.mrp ?? null,
            sellingPrice: variant.sellingPrice ?? null,
            inventoryQty: variant.inventoryQty,
            status: variant.status,
          },
        });
        variantRows.push({ id: createdVariant.id, skuCode: createdVariant.skuCode });
      }

      if (Array.isArray(productDefinition.taxCodes) && productDefinition.taxCodes.length > 0) {
        for (const taxCode of productDefinition.taxCodes) {
          const regime = taxRegimes.get(taxCode.regimeKey);
          if (!regime) {
            continue;
          }
          await prisma.productTaxCode.create({
            data: {
              tenantKey,
              productId: createdProduct.id,
              regimeId: regime.id,
              marketCode: regime.marketCode,
              key: taxCode.key,
              value: taxCode.value,
              rate: taxCode.rate ?? null,
            },
          });
        }
      }

      await prisma.mediaAsset.create({
        data: {
          id: randomId("media"),
          tenantKey,
          productId: createdProduct.id,
          entityType: "product",
          fileName: `${productDefinition.key}.jpg`,
          mimeType: "image/jpeg",
          storagePath: `qa/${DATASET_ID}/${productDefinition.key}.jpg`,
          sizeBytes: 245_000,
          checksum: crypto.createHash("sha1").update(productDefinition.key).digest("hex"),
          metadata: {
            datasetId: DATASET_ID,
            sourceUrl: productDefinition.attributes.primaryImageUrl,
            altText: productDefinition.title,
          },
        },
      });

      if (productDefinition.businessScenario === "quality.incomplete_product") {
        await prisma.validationIssue.create({
          data: {
            tenantKey,
            productId: createdProduct.id,
            severity: "warning",
            ruleCode: "CORE_MISSING_HSN",
            message: "HSN code is missing for this product.",
            fieldPath: "hsnCode",
          },
        });
      }

      if (productDefinition.businessScenario === "quality.approval_blocked") {
        await prisma.validationIssue.create({
          data: {
            tenantKey,
            productId: createdProduct.id,
            severity: "error",
            ruleCode: "GST_TAX_MISSING_HSN",
            message: "Product still has blocking tax data issues and cannot be approved.",
            fieldPath: "hsnCode",
          },
        });
      }

      if (Array.isArray(productDefinition.postSeedActions)) {
        if (productDefinition.postSeedActions.includes("approval_comment")) {
          await prisma.approvalComment.create({
            data: {
              tenantKey,
              productId: createdProduct.id,
              actorId: ROLE_IDENTITIES.reviewer,
              actorRole: "reviewer",
              body: "QA pack note: ready for manual approval and activity checks.",
            },
          });
        }

        if (productDefinition.postSeedActions.includes("reviewer_change_request_open")) {
          const request = await prisma.changeRequest.create({
            data: {
              tenantKey,
              productId: createdProduct.id,
              requesterId: ROLE_IDENTITIES.reviewer,
              requesterRole: "reviewer",
              reason: "QA pack request: confirm attribute and compliance completeness before approval.",
              status: productDefinition.postSeedActions.includes("reviewer_change_request_resolve") ? "resolved" : "open",
              resolvedAt: productDefinition.postSeedActions.includes("reviewer_change_request_resolve") ? new Date() : null,
              resolvedById: productDefinition.postSeedActions.includes("reviewer_change_request_resolve") ? ROLE_IDENTITIES.admin : null,
            },
          });

          await prisma.auditLog.create({
            data: {
              id: randomId("audit"),
              tenantKey,
              actorId: ROLE_IDENTITIES.reviewer,
              actorRole: "reviewer",
              action: "CHANGE_REQUEST_CREATED",
              resource: "/api/v1/catalog/products/:id/change-requests",
              resourceId: createdProduct.id,
              metadata: { requestId: request.id, datasetId: DATASET_ID },
            },
          });
        }
      }

      for (const entry of buildStatusAuditEntries(createdProduct.id, productDefinition, ROLE_IDENTITIES.editor)) {
        await prisma.auditLog.create({ data: entry });
      }

      if (["approved", "rejected", "in_review"].includes(productDefinition.status)) {
        await prisma.userNotification.create({
          data: {
            id: randomId("notif"),
            tenantKey,
            userId: ROLE_IDENTITIES.reviewer,
            eventType: productDefinition.status === "rejected" ? "product_rejected" : "product_ready_for_review",
            title: `${productDefinition.title} is ${productDefinition.status.replace(/_/g, " ")}`,
            message: `${productDefinition.title} is available for QA workflow verification.`,
            actionUrl: `/products/${createdProduct.id}`,
            actionLabel: "Open product",
            metadata: { datasetId: DATASET_ID, productId: createdProduct.id },
          },
        });
      }

      if (productDefinition.key === "sprig-uniform-twin-tee-pack" || productDefinition.key === "northline-weekend-checked-shirt") {
        bulkEditTargets.push(createdProduct);
      }

      if (productDefinition.status === "approved") {
        approvedProducts.push(createdProduct);
      }

      createdProducts.push({
        key: productDefinition.key,
        id: createdProduct.id,
        title: createdProduct.title,
        status: createdProduct.status,
        variants: variantRows,
      });
    }

    const {
      connectorInstallationId,
      mappingVersionIds,
      submissionIds,
      bulkEditOperationIds,
      importJobIds,
    } = await createOptionalOpsArtifacts({
      prisma,
      pack,
      tenantKey,
      seedOptions,
      categoryByKey,
      approvedProducts,
      bulkEditTargets,
    });

    const runtimeManifest = {
      datasetId: pack.datasetId,
      tenantKey,
      mode: "db",
      seededAt: new Date().toISOString(),
      options: {
        withOps: seedOptions.withOps,
        allowControlPlaneMutations: seedOptions.allowControlPlaneMutations,
      },
      resolvedCategories: categoryRows,
      createdCategories: categoryOwnership.createdCategories,
      reusedCategories: categoryOwnership.reusedCategories,
      createdCategoryIds: categoryOwnership.createdCategoryIds,
      reusedCategoryIds: categoryOwnership.reusedCategoryIds,
      createdAttributeDefinitions: createdAttributeRows,
      createdAttributeDefinitionIds: createdAttributeRows.map((definition) => definition.id),
      products: createdProducts,
      connectors: {
        installationIds: connectorInstallationId ? [connectorInstallationId] : [],
        mappingVersionIds,
        submissionIds,
      },
      ops: {
        bulkEdit: {
          status: seedOptions.withOps ? "created" : "not_requested",
          operationIds: bulkEditOperationIds,
        },
        importJob: {
          status: seedOptions.withOps ? "created" : "not_requested",
          jobIds: importJobIds,
        },
      },
      blockers: [
        {
          type: "api_runtime",
          detail: "Dataset was seeded directly to Postgres because the local API did not become reachable during this run.",
        },
      ],
      cleanupSummary,
      controlPlane,
    };

    ensureDir(path.dirname(runtimeManifestPath));
    fs.writeFileSync(runtimeManifestPath, JSON.stringify(runtimeManifest, null, 2) + "\n", "utf8");

    return {
      status: "ok",
      mode: "db",
      datasetId: pack.datasetId,
      runtimeManifestPath,
      createdCategoryCount: categoryOwnership.createdCategoryIds.length,
      createdAttributeDefinitionCount: createdAttributeRows.length,
      productCount: createdProducts.length,
      bulkImportJobId: importJobIds[0] ?? null,
      connectorInstallationId,
      controlPlaneMutated: controlPlane.applied,
    };
  } finally {
    await prisma.$disconnect();
  }
}

async function main() {
  const result = await seedDirectQaPack({});
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Direct realistic QA pack seed failed:");
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exit(1);
  });
}

module.exports = {
  cleanupExistingDataset,
  createOptionalOpsArtifacts,
  maybeSeedControlPlane,
  readRuntimeManifest,
  seedDirectQaPack,
};
