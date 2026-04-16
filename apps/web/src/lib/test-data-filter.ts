const TEST_PREFIXES = [
  "phase2 ",
  "phase3 ",
  "phase4 ",
  "phase5 ",
  "phase6 ",
  "phase7 ",
  "phase8 ",
  "smoke ",
  "rbac ",
  "concurrency ",
  "audit ",
  "benchmark",
  "metrics ",
  "reject score ",
  "media smoke ",
  "ondc smoke ",
  "ai smoke ",
  "pilot ",
  "template ",
  "version ",
  "xlsx ",
  "e2e-",
  "qa flow ",
  "pim1 qa flow ",
  "ui-reality-",
  "manual cat ",
];

export function isTestData(name: string): boolean {
  const value = name.trim().toLowerCase();
  return TEST_PREFIXES.some((prefix) => value.startsWith(prefix));
}

interface TestDataShape {
  title?: string;
  name?: string;
  path?: string;
  categoryName?: string;
  categoryPath?: string;
  category?: {
    name?: string;
    path?: string;
  } | null;
}

function getCandidateLabels(item: TestDataShape): string[] {
  return [
    item.title,
    item.name,
    item.path,
    item.categoryName,
    item.categoryPath,
    item.category?.name,
    item.category?.path,
  ]
    .map((value) => String(value ?? "").trim())
    .filter((value) => value.length > 0);
}

export function filterTestData<T extends TestDataShape>(
  items: T[],
  hide: boolean,
): T[] {
  if (!hide) {
    return items;
  }
  return items.filter((item) => {
    return !getCandidateLabels(item).some((label) => isTestData(label));
  });
}
