export const SOFT_DELETE_BYPASS_ARG = "__pimBypassSoftDelete";

const PRODUCT_MODEL = "Product";
const SOFT_DELETE_FIELD = "deletedAt";

const SOFT_DELETE_FILTER_OPERATIONS = new Set<string>([
  "count",
  "aggregate",
  "groupBy",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
]);

const SOFT_DELETE_UNIQUE_OPERATIONS = new Set<string>([
  "findUnique",
  "findUniqueOrThrow",
]);

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeWhereWithSoftDelete(where: unknown): JsonRecord {
  if (isRecord(where)) {
    return {
      AND: [
        where,
        {
          [SOFT_DELETE_FIELD]: null,
        },
      ],
    };
  }
  return {
    [SOFT_DELETE_FIELD]: null,
  };
}

function mergeUniqueWhereWithSoftDelete(where: unknown): JsonRecord {
  if (isRecord(where)) {
    return {
      ...where,
      [SOFT_DELETE_FIELD]: null,
    };
  }
  return {
    [SOFT_DELETE_FIELD]: null,
  };
}

export function withSoftDeleteBypass<T extends Record<string, unknown>>(args: T): T {
  return {
    ...args,
    [SOFT_DELETE_BYPASS_ARG]: true,
  };
}

export function applyProductSoftDeleteScope(
  model: string | undefined,
  operation: string,
  args: JsonRecord,
): JsonRecord {
  if (model !== PRODUCT_MODEL) {
    return args;
  }

  const nextArgs: JsonRecord = { ...args };
  const bypassSoftDelete = nextArgs[SOFT_DELETE_BYPASS_ARG] === true;
  delete nextArgs[SOFT_DELETE_BYPASS_ARG];

  if (bypassSoftDelete) {
    return nextArgs;
  }

  if (SOFT_DELETE_FILTER_OPERATIONS.has(operation)) {
    nextArgs.where = mergeWhereWithSoftDelete(nextArgs.where);
  } else if (SOFT_DELETE_UNIQUE_OPERATIONS.has(operation)) {
    nextArgs.where = mergeUniqueWhereWithSoftDelete(nextArgs.where);
  }

  return nextArgs;
}
