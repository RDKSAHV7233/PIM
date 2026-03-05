const TEST_PREFIXES = [
  "Phase2 ",
  "Phase3 ",
  "Phase4 ",
  "Phase5 ",
  "Phase6 ",
  "Phase7 ",
  "Phase8 ",
  "Smoke ",
  "RBAC ",
  "Concurrency ",
  "Audit ",
  "Benchmark",
  "Metrics ",
  "Reject Score ",
  "Media Smoke ",
  "ONDC Smoke ",
  "AI Smoke ",
  "Pilot ",
  "Template ",
  "Version ",
  "Xlsx ",
];

export function isTestData(name: string): boolean {
  const value = name.trim();
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
