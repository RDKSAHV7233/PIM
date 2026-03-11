const fs = require("fs");
const path = require("path");

function assertIncludes(file, snippet, message) {
  const source = fs.readFileSync(file, "utf8");
  if (!source.includes(snippet)) {
    throw new Error(message);
  }
}

const root = process.cwd();
const inputPath = path.join(root, "apps/web/src/components/ui/input.tsx");
const selectPath = path.join(root, "apps/web/src/components/ui/select.tsx");
const categoriesPagePath = path.join(root, "apps/web/src/app/catalog/categories/page.tsx");

assertIncludes(
  inputPath,
  "suppressHydrationWarning",
  "Input should suppress hydration warnings for extension-injected autofill attributes.",
);

assertIncludes(
  selectPath,
  "suppressHydrationWarning",
  "Select should suppress hydration warnings for extension-injected autofill attributes.",
);

assertIncludes(
  categoriesPagePath,
  "<form action={createCategoryAction} className=\"space-y-3\" suppressHydrationWarning>",
  "Catalog categories create form should suppress hydration warnings at the form boundary.",
);

console.log("catalog-categories hydration safeguards present");
