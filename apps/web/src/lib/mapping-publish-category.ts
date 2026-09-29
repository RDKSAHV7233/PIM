// The publish-category option list is a capped, filtered search result. The category the wizard
// already selected (for example the resolver's default target) is often not in it, and the UI then
// fell back to printing the raw id. Build a display-only option for it from the category tree.

export interface PublishCategoryOption {
  id: string;
  path: string;
  requiredAttributes: string[];
}

export function buildSelectedPublishCategoryOption(
  selectedId: string,
  matches: Array<{ id: string }>,
  unmapped: Array<{ id: string }>,
  categories: Array<{ id: string; path: string }>,
): PublishCategoryOption | null {
  if (!selectedId) {
    return null;
  }
  if (matches.some((item) => item.id === selectedId) || unmapped.some((item) => item.id === selectedId)) {
    return null;
  }
  const category = categories.find((item) => item.id === selectedId);
  return category ? { id: category.id, path: category.path, requiredAttributes: [] } : null;
}
