# PIM Product QA PO Remediation Plan - 2026-04-25

## Decision

Status: Blocked pending real product inputs.

The PO review cannot approve publication because the product identifiers, channel, market, connector, source PIM, brand, category, and internet verification flag were placeholders. This plan converts that blocked review into an executable remediation path.

## Fix Plan

| Priority | Fix | Owner | Validation |
|---|---|---|---|
| P0 | Replace placeholder SKU and/or Product ID with a real product identifier. | Source Data / PO | Input gate passes product retrieval readiness; connector retrieves exactly one product. |
| P0 | Provide target channel or marketplace. | PO / Channel Ops | Channel readiness can run for the selected channel; required-field matrix is channel-specific. |
| P0 | Provide locale or market. | PO / Regional Ops | Locale readiness can validate language, currency, unit, and market compliance expectations. |
| P0 | Provide connector/tool names or confirm all available connectors. | Configuration / Connector Owner | Connector definition and installation checks identify the correct retrieval and publish path. |
| P0 | Provide source PIM system. | PO / Data Governance | Findings can be routed to Source Data versus Connector or Mapping owners. |
| P1 | Provide brand and category. | Source Data / Merchandising | Brand consistency, taxonomy, and category-required attribute checks can run. |
| P1 | Provide product URL when already published. | Channel Ops | Internet verification can compare public content, media, price, and availability. |
| P1 | Confirm internet verification as yes or no. | PO | External reference checks are either executed with cited sources or marked Not Applicable. |

## Validation Plan

1. Input gate
   - Command: `node scripts/pim-product-qa-input-gate.cjs --sku <SKU> --product-id <PRODUCT_ID> --channel <CHANNEL> --locale <LOCALE> --brand <BRAND> --category <CATEGORY> --source-pim <PIM> --connectors <CONNECTORS> --internet-verification yes|no`
   - Pass condition: result is `Ready`.

2. Product retrieval and identity
   - Retrieve by SKU and Product ID where both are provided.
   - Confirm the returned product matches SKU, ID, brand, and category.
   - Confirm no duplicate SKU/product record is visible through the source PIM or connector.

3. Source product data QA
   - Validate identity, content, attributes, media, variants, commerce, and governance fields.
   - Separate missing source data from connector or mapping behavior.

4. Connector and channel readiness
   - Review connector definitions and installed connector account state.
   - Run mapping preflight, marketplace simulation, payload preview, publish readiness, and submission lifecycle checks for the selected channel.

5. Locale and market readiness
   - Validate localized fields, currency, unit of measure, compliance text, and market-specific claim safety.

6. Internet verification
   - If required, verify public title, brand, category, specifications, images, listing content, price, and availability.
   - Label differences as Internet Reference Mismatch unless connector evidence proves otherwise.

## Execution Log

Completed:
- Added `scripts/pim-product-qa-input-gate.cjs` to make placeholder inputs fail fast.
- Added `npm run qa:pim-product:inputs` as the repeatable input-gate command.
- Updated stale route-contract assertions for current shared channel normalization and connector publication-target behavior.
- Preserved the PO decision as Blocked until real product inputs are supplied.

Blocked:
- Product-specific data fixes cannot be applied because SKU/Product ID are not provided.
- Channel mapping and marketplace feed fixes cannot be applied because channel and connector inputs are not provided.
- Internet verification cannot run because product URL and internet-verification decision are not provided.

## PO Validation Evidence

PO validation date: 2026-04-25

PO acceptance status for remediation infrastructure: Accepted.

PO release status for the requested product review: Blocked pending real product inputs.

| Validation | Command | Result | PO Evidence |
|---|---|---|---|
| Placeholder input blocking | `node scripts/pim-product-qa-input-gate.cjs --sku "[SKU]" --product-id "[PRODUCT_ID]" --channel "[CHANNEL]" --locale "[LOCALE_OR_MARKET]" --brand "[BRAND]" --category "[CATEGORY]" --source-pim "[PIM_SYSTEM_NAME]" --connectors "[CONNECTOR_NAMES_OR_ALL_AVAILABLE]" --internet-verification "Yes/No" --format json` | Passed | Gate returns `Blocked` and marks critical placeholder inputs as `Not Provided`. |
| Ready input path | `npm run qa:pim-product:inputs -- --sku TEST-SKU --product-id PROD-123 --channel shopify --locale en-IN --brand TestBrand --category Apparel --source-pim Vexa --connectors shopify --internet-verification no --format json` | Passed | Gate returns `Ready` when PO-critical inputs are supplied. |
| API type safety | `npm run lint --workspace @pim1/api` | Passed | Backend compile/type contract is clean. |
| Web type safety | `npm run lint --workspace @pim1/web` | Passed | Frontend compile/type contract is clean. |
| Catalog/product PO validation | `npm run test:product:catalog` | Passed | Product workbench, product detail, normalization, pricing, workflow, and catalog route contracts pass. |
| Publish/channel PO validation | `npm run test:product:publish` | Passed | Channel overview, health, submissions, connector detail, mapping lifecycle, readiness batch, and submission lifecycle pass. |
| Shopify live presentation | `node apps/web/test/integration/connector-launch-honesty-ui.test.cjs` and `node apps/web/test/integration/shopify-managed-install-handoff-ui.test.cjs` | Passed | Shopify setup/catalog copy remains live and managed-install focused, not guided-rollout focused. |

## PO Findings

Accepted:
- The review can no longer silently proceed with placeholder inputs.
- Product/catalog and channel/publish validation surfaces are executable and currently passing.
- Connector/channel deep links use shared connector-slug to marketplace-channel normalization.
- Connector detail validation covers publication target management, managed-install guidance, submissions, product lookup data, and access workflows.

Still blocked:
- No real product can be retrieved until SKU and/or Product ID are supplied.
- No source product data can be fixed until the source PIM record is identified.
- No product-specific channel mapping can be approved until the target channel and connector context are real inputs.
- No internet verification can be performed until the PO provides the internet-verification decision and, when available, a product URL.

## PO Decision

The remediation execution layer is accepted for use.

The product QA review remains blocked for release approval. The next PO checkpoint is to supply the real SKU/Product ID, channel, locale/market, source PIM, connector list, brand, category, and internet-verification decision, then rerun the input gate and full product QA review against actual connector data.

## Approval Conditions

PO approval can be reconsidered only after:
- Input gate returns `Ready`.
- Product is retrieved exactly once by SKU and/or Product ID.
- Full product field validation has no critical failures.
- Channel readiness has no blocking required-field, mapping, or connector issues.
- Media and public/customer-facing content are accurate and accessible.
- Pricing, availability, locale, and compliance checks pass or have approved exceptions.
