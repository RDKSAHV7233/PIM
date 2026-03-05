# E2-E4 Execution Record (ST-CAT-001 through ST-BE-002)

- Date: 2026-03-03
- Scope: `E2 Catalog and Compliance Core`, `E3 Bulk Import and Row Repair`, `E4 Bulk Edit and History`
- Source backlog: `docs/execution/PRD_TO_ENGINEERING_BACKLOG.md`
- Validation mode: code-path verification + build/lint gates

## E2. Catalog and Compliance Core

### ST-CAT-001: Product compliance labeling clarity
- PRD mapping: `FR-002`
- Status: Complete
- Acceptance evidence:
1. Product list column uses label `Compliance Issues` in [products-tab.tsx](C:\Users\Om Computers\PIM1\apps\web\src\components\product\products-tab.tsx).
2. Tooltip is present on header and explicitly distinguishes compliance from channel readiness in [products-tab.tsx](C:\Users\Om Computers\PIM1\apps\web\src\components\product\products-tab.tsx).
3. Info indicator is rendered as `[i]` next to header label for scope cue in [products-tab.tsx](C:\Users\Om Computers\PIM1\apps\web\src\components\product\products-tab.tsx).

### ST-CAT-002: Category role behavior
- PRD mapping: `FR-007`
- Status: Complete
- Acceptance evidence:
1. Categories list is visible for all roles in [page.tsx](C:\Users\Om Computers\PIM1\apps\web\src\app\page.tsx).
2. Category create form is rendered only when `canAdmin` is true in [page.tsx](C:\Users\Om Computers\PIM1\apps\web\src\app\page.tsx).
3. Non-admin path renders only helper text (no disabled create card) in [page.tsx](C:\Users\Om Computers\PIM1\apps\web\src\app\page.tsx).

## E3. Bulk Import and Row Repair

### ST-IMP-001: Import templates management
- PRD mapping: `FR-005`
- Status: Complete
- Acceptance evidence:
1. Template create endpoint exists at `POST /bulk-import/templates` in [bulk-import.controller.ts](C:\Users\Om Computers\PIM1\apps\api\src\bulk-import\bulk-import.controller.ts).
2. Template list endpoint exists with tenant/category filtering at `GET /bulk-import/templates` in [bulk-import.controller.ts](C:\Users\Om Computers\PIM1\apps\api\src\bulk-import\bulk-import.controller.ts).
3. Template update behavior is versioned-save semantics: same tenant/category/name increments `version` and inserts latest template snapshot in [bulk-import.service.ts](C:\Users\Om Computers\PIM1\apps\api\src\bulk-import\bulk-import.service.ts).
4. UI template selection pre-fills import defaults (`category`, `sourceFormat`, `chunkSize`, `maxRetries`, `mapping`) in [page.tsx](C:\Users\Om Computers\PIM1\apps\web\src\app\page.tsx).

### ST-IMP-002: Import job processing with retry/DLQ
- PRD mapping: `FR-005`
- Status: Complete
- Acceptance evidence:
1. Job lifecycle states include queued/processing/retrying/completed/failed/dead_letter in [schema.prisma](C:\Users\Om Computers\PIM1\packages\db\prisma\schema.prisma) and [bulk-import.service.ts](C:\Users\Om Computers\PIM1\apps\api\src\bulk-import\bulk-import.service.ts).
2. Failed/dead-letter row retry path exists via `POST /bulk-import/jobs/:id/requeue-dlq` in [bulk-import.controller.ts](C:\Users\Om Computers\PIM1\apps\api\src\bulk-import\bulk-import.controller.ts).
3. Error export endpoint exists at `GET /bulk-import/jobs/:id/error-report` and UI action is wired in [bulk-import.controller.ts](C:\Users\Om Computers\PIM1\apps\api\src\bulk-import\bulk-import.controller.ts) and [page.tsx](C:\Users\Om Computers\PIM1\apps\web\src\app\page.tsx).

### ST-IMP-003: Row repair console
- PRD mapping: `FR-005`
- Status: Complete
- Acceptance evidence:
1. Repair endpoint exists at `POST /bulk-import/jobs/:id/rows/:rowId/repair` in [bulk-import.controller.ts](C:\Users\Om Computers\PIM1\apps\api\src\bulk-import\bulk-import.controller.ts).
2. Repair UI shows translated errors and editable row repair form in [page.tsx](C:\Users\Om Computers\PIM1\apps\web\src\app\page.tsx) and [row-repair-form.tsx](C:\Users\Om Computers\PIM1\apps\web\src\components\ui\row-repair-form.tsx).
3. Service requeues repaired rows with status transition for retry processing in [bulk-import.service.ts](C:\Users\Om Computers\PIM1\apps\api\src\bulk-import\bulk-import.service.ts).

## E4. Bulk Edit and History

### ST-BE-001: Bulk edit preview and apply
- PRD mapping: `FR-006`
- Status: Complete
- Acceptance evidence:
1. Preview endpoint exists at `POST /bulk-edit/preview` and apply endpoint at `POST /bulk-edit/apply` in [bulk-edit.controller.ts](C:\Users\Om Computers\PIM1\apps\api\src\bulk-edit\bulk-edit.controller.ts).
2. Scope filters (`categoryId`, `status`, `brandContains`, `productIds`) are normalized and applied in query builder in [bulk-edit.service.ts](C:\Users\Om Computers\PIM1\apps\api\src\bulk-edit\bulk-edit.service.ts).
3. UI preview flow renders affected count and diff preview, then applies updates via action in [page.tsx](C:\Users\Om Computers\PIM1\apps\web\src\app\page.tsx) and [bulk-edit-diff-preview.tsx](C:\Users\Om Computers\PIM1\apps\web\src\components\bulk-edit\bulk-edit-diff-preview.tsx).

### ST-BE-002: Immutable operation history
- PRD mapping: `FR-006`
- Status: Complete
- Acceptance evidence:
1. Operations history is exposed read-only via `GET /bulk-edit/operations` and `GET /bulk-edit/operations/:id` in [bulk-edit.controller.ts](C:\Users\Om Computers\PIM1\apps\api\src\bulk-edit\bulk-edit.controller.ts).
2. Service writes operation and item records during apply and only updates summary counters/status for that operation; no mutation endpoint exists for completed records in [bulk-edit.service.ts](C:\Users\Om Computers\PIM1\apps\api\src\bulk-edit\bulk-edit.service.ts).
3. UI history table renders requested/applied/failed counts and update payload in [page.tsx](C:\Users\Om Computers\PIM1\apps\web\src\app\page.tsx).

## Gate Checks
- `npm run lint --workspace @pim1/web` -> Pass
- `npm run build --workspace @pim1/web` -> Pass
- `npm run lint --workspace @pim1/api` -> Pass
- `npm run build --workspace @pim1/api` -> Pass

## Outcome
`E2`, `E3`, and `E4` stories listed above are completed and validated against current PRD scope.
