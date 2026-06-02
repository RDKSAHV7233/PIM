# Error Message Review Checklist

**Purpose**: Before launch, manually verify every error state shows a message a seller can act on.
**Duration**: ~2 hours
**Who**: PO or CTO, not QA — this is product taste, not functional testing.

## How to run

1. Start local dev: `npm run dev:api` + `npm run dev:web`
2. Open browser at `http://localhost:3001`
3. For each row below, trigger the error and check the message

## Error States to Verify

| # | Trigger | Expected Message | Actual | Pass? |
|---|---------|-----------------|--------|-------|
| 1 | Login with wrong password | "Invalid credentials" or similar | | |
| 2 | Login with non-existent workspace | "Workspace not found" | | |
| 3 | Login with disabled account | "Account is disabled" | | |
| 4 | Session expired (wait 4h or manually expire JWT) | Redirect to /login with "Session expired" | | |
| 5 | Create product missing required title | Field-level validation error | | |
| 6 | Create product with duplicate SKU (if enforced) | "Product already exists" or similar | | |
| 7 | Import CSV with wrong headers | "Column X not recognized" | | |
| 8 | Import CSV with >30,000 rows | "Maximum 30,000 rows" | | |
| 9 | Import empty file | "File is empty" | | |
| 10 | Upload image >10MB | "File too large" with size guidance | | |
| 11 | Upload non-image file (.txt) | "Invalid file format" | | |
| 12 | Hit SKU plan limit (STARTER: 500) | "You reached your SKU limit" + upgrade CTA | | |
| 13 | Hit submission plan limit | "You reached your submission limit" + upgrade CTA | | |
| 14 | Hit user plan limit (STARTER: 3) | "User limit reached (3/3)" + upgrade link | | |
| 15 | Hit connector installation limit | "You reached your connector installation limit" | | |
| 16 | Hit storage limit | "You reached your storage limit" | | |
| 17 | Non-admin tries /admin/users | Redirect or "Access denied" | | |
| 18 | Viewer tries to edit product | Edit button hidden or disabled | | |
| 19 | Navigate to /products/fake-uuid | Styled 404 page | | |
| 20 | Navigate to /this-does-not-exist | Styled 404 page | | |
| 21 | Connector credential expired | Warning banner visible | | |
| 22 | Invite user with existing email | "User already exists" | | |
| 23 | Invite user with empty email | "Email is required" | | |
| 24 | Suspended tenant login | Redirect to /account-suspended | | |
| 25 | Publish product missing required fields | "Product not ready" + list of issues | | |

## Grading

- **Pass**: Seller knows what happened AND what to do next
- **Partial**: Seller knows what happened but not what to do (e.g. "Error" without guidance)
- **Fail**: Raw error code, blank page, crash, or "Something went wrong"

## After Review

1. Fix all "Fail" items before launch — estimated 0.5-1 day
2. Fix "Partial" items in first post-launch sprint
3. Commit this checklist with results as `docs/checklists/error-message-review-YYYY-MM-DD.md`
