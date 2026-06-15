#!/usr/bin/env node

function normalizeSeedOptions(options = {}) {
  return {
    withOps: options.withOps === true,
    allowControlPlaneMutations: options.allowControlPlaneMutations === true,
  };
}

function sortCategoriesForDeletion(categories) {
  return [...categories].sort((left, right) => {
    const leftDepth = String(left.path ?? "").split("/").length;
    const rightDepth = String(right.path ?? "").split("/").length;
    return rightDepth - leftDepth;
  });
}

function buildCategoryOwnership(categoryRows, createdCategoryIds = []) {
  const createdIdSet = new Set(createdCategoryIds.filter(Boolean));
  const createdCategories = [];
  const reusedCategories = [];

  for (const category of categoryRows ?? []) {
    if (createdIdSet.has(category.id)) {
      createdCategories.push(category);
      continue;
    }
    reusedCategories.push(category);
  }

  return {
    createdCategories,
    reusedCategories,
    createdCategoryIds: createdCategories.map((category) => category.id),
    reusedCategoryIds: reusedCategories.map((category) => category.id),
  };
}

function getCategoryOwnership(manifest = {}) {
  const createdCategories = Array.isArray(manifest.createdCategories)
    ? manifest.createdCategories
    : Array.isArray(manifest.categoryOwnership?.createdCategories)
      ? manifest.categoryOwnership.createdCategories
      : [];
  const reusedCategories = Array.isArray(manifest.reusedCategories)
    ? manifest.reusedCategories
    : Array.isArray(manifest.categoryOwnership?.reusedCategories)
      ? manifest.categoryOwnership.reusedCategories
      : [];
  const createdCategoryIds = Array.isArray(manifest.createdCategoryIds)
    ? manifest.createdCategoryIds
    : Array.isArray(manifest.categoryOwnership?.createdCategoryIds)
      ? manifest.categoryOwnership.createdCategoryIds
      : createdCategories.map((category) => category.id).filter(Boolean);
  const reusedCategoryIds = Array.isArray(manifest.reusedCategoryIds)
    ? manifest.reusedCategoryIds
    : Array.isArray(manifest.categoryOwnership?.reusedCategoryIds)
      ? manifest.categoryOwnership.reusedCategoryIds
      : reusedCategories.map((category) => category.id).filter(Boolean);

  return {
    createdCategories,
    reusedCategories,
    createdCategoryIds,
    reusedCategoryIds,
  };
}

function hasExplicitCategoryOwnership(manifest = {}) {
  const ownership = getCategoryOwnership(manifest);
  return (
    ownership.createdCategories.length > 0 ||
    ownership.reusedCategories.length > 0 ||
    ownership.createdCategoryIds.length > 0 ||
    ownership.reusedCategoryIds.length > 0
  );
}

function getDatasetProductWhere(tenantKey, datasetId) {
  return {
    tenantKey,
    attributes: {
      path: ["qaDataset", "datasetId"],
      equals: datasetId,
    },
  };
}

module.exports = {
  buildCategoryOwnership,
  getCategoryOwnership,
  getDatasetProductWhere,
  hasExplicitCategoryOwnership,
  normalizeSeedOptions,
  sortCategoriesForDeletion,
};
