# Mapping Manager Discoverability Execution Record (2026-03-04)

## Scope
- Story alignment: Seller-first operational discoverability within Products workflow.
- Objective: Make connector mapping management visible from landing workflow without requiring deep navigation.

## Changes
1. Added `mappingManagerHref` prop to products tab component.
2. Computed mapping manager route in home page using:
   - first visible product,
   - first active connector installation,
   - slug-to-channel mapping (`amazon-in -> amazon`, `flipkart`, `meesho`).
3. Rendered `Open Mapping Manager` link in Products tab `Getting Started` panel when route is available.

## Files
- [apps/web/src/app/page.tsx](C:/Users/Om Computers/PIM1/apps/web/src/app/page.tsx)
- [apps/web/src/components/product/products-tab.tsx](C:/Users/Om Computers/PIM1/apps/web/src/components/product/products-tab.tsx)

## Acceptance Evidence
- Products landing now exposes direct mapping manager navigation from onboarding section when tenant has:
  - at least one visible product,
  - at least one active connector installation with mapped channel.
- No regression in web compile/type checks.

## Validation
- `npm run lint --workspace @pim1/web` -> pass
- `npm run build --workspace @pim1/web` -> pass
