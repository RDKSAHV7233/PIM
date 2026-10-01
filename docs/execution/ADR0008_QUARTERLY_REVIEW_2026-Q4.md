---
title: ADR-0008 §2 Quarterly Schema Review — 2026-Q4
status: in_progress — awaiting partner/PO template verification
owner: PO + Connector Admin (per connector below)
triggered_by: ADR-0008 §2 quarterly review schedule; schema-template-stale INFO findings (127d / 112d)
increment: INC-62
opened: 2026-10-01
---

# ADR-0008 §2 Quarterly Schema Review — 2026-Q4

## Scope and authority

This document formalises the ADR-0008 §2 quarterly review for local-registry
connectors whose `templateVerifiedAt` dates have exceeded the 90-day inventory
threshold. Per ADR-0013 §2 (Signal B), the review process is:

1. Re-download the current template from the marketplace
2. Diff column names, required flags, and allowed values against the version in code
3. Record the outcome (no change / additive / breaking)
4. Update `templateVerifiedAt` (and `schemaVersion` if structure changed)
5. PO/Connector Admin sign-off

This document **cannot** substitute for partner/PO verification. Only once that
verification is complete may `templateVerifiedAt` be updated to a current date.

## Current stale-template findings

| Connector | Staleness (as of 2026-10-01) | Source | Action owner |
|-----------|------------------------------|--------|-------------|
| Meesho | 127 days (last verified 2026-05-27) | supplier.meesho.com download | PO / Meesho seller account |
| Myntra | 112 days (last verified 2026-06-11) | Myntra account manager API | PO / Myntra account manager |
| Nykaa | 112 days (last verified 2026-06-11) | seller.nykaa.com | PO / Nykaa seller account |

---

## Connector 1: Meesho

**Source file**: `apps/api/src/connectors/meesho/meesho-category-templates.ts`  
**Templates**: kurtis, tshirts, sarees, casual-shoes, leggings, home-decor, general  
**Current `templateVerifiedAt`**: `2026-05-27` (all 7 templates)

### Re-download process

1. Log in to [supplier.meesho.com](https://supplier.meesho.com)
2. Navigate to: **Catalog → Upload Catalog → Download Template**
3. Download each category template (one per slug above)
4. Compare column headers and allowed values against current code

### Current template structure (code baseline)

**Shared base columns** (all categories):
SKU ID, Product Name, MRP, Selling Price, Brand, HSN Code, GST Rate (%),
Country of Origin, Description, Image URL 1–5

**Category-specific additions**:

| Category | Category-specific columns |
|----------|--------------------------|
| kurtis | Colour, Size, Pattern, Fabric, Occasion, Sleeve Length |
| tshirts | Colour, Size, Pattern, Fabric, Neck Type, Sleeve Length |
| sarees | Colour, Fabric, Occasion, Work/Embellishment, Blouse Fabric |
| casual-shoes | Colour, Size (UK/India), Material, Sole Material, Closure |
| leggings | Colour, Size, Pattern, Fabric, Waist Type |
| home-decor | Colour, Material, Dimensions, Room Type |
| general | (base columns only) |

### Diff checklist (per template)

For each downloaded template, check:

- [ ] All existing column headers still present and spelled identically?
- [ ] GST Rate allowed values unchanged (`0, 5, 12, 18, 28`)?
- [ ] Colour allowed values unchanged (long enumeration in code)?
- [ ] Size allowed values unchanged?
- [ ] Any new required columns added?
- [ ] Any columns removed or renamed?

### Outcome recording

Per ADR-0013 §2 Signal B:

| Outcome | Action required |
|---------|----------------|
| No change | Update `templateVerifiedAt` to today in all 7 templates |
| Additive change (new optional columns) | Add columns to template, update `templateVerifiedAt`, bump schemaVersion to `LOCAL-<today>` |
| Breaking change (new required columns, value restrictions) | Update template, bump schemaVersion, set affected `ConnectorMappingVersion.compatibilityState` to `remap_required` |

**Sign-off required**: PO confirms template comparison completed and outcome recorded.

---

## Connector 2: Myntra

**Source file**: `apps/api/src/connectors/myntra/myntra-category-rules.ts`  
**Categories**: apparel, footwear, ethnic-wear, default  
**Current `templateVerifiedAt`**: `2026-06-11` (categories apparel/footwear/ethnic-wear marked `[NEEDS_PARTNER_CONFIRMATION]`)  

### Re-download / verification process

Myntra uses a Listing Management API — not a downloadable Excel template.
Verification requires:

1. Contact Myntra account manager to obtain the latest field specification
   for apparel, footwear, and ethnic-wear categories
2. Run the Postman collection obtained during account-manager kickoff (gate ST-MYNTRA-001)
   against the sandbox to retrieve current `allowedValues` for each attribute
3. Compare against the current attribute sets in code

### Current field sets (code baseline)

**Shared base fields** (all categories):
Style ID / SKU, Product Name, Brand, MRP, Discount %, Fabric, Description, Season, Images

**Category-specific additions**:

| Category | Category-specific fields |
|----------|------------------------|
| apparel | Gender, Age Group, Size (S/M/L/XL/XXL), Colour, Pattern, Neck Type, Sleeve Length, Fit Type |
| footwear | Gender, Age Group, Size (UK/IND), Colour, Toe Shape, Closure Type, Sole Material, Outer Material |
| ethnic-wear | Gender, Age Group, Size, Colour, Pattern, Fabric, Occasion, Work Type, Set Count |

**`[NEEDS_PARTNER_CONFIRMATION]` annotation meaning**: The `allowedValues` enumerations in code
were derived from publicly available seller guidelines and third-party integration documentation
(Vinculum, Base PPMP guide), NOT from direct Myntra API verification. Partner confirmation is
required before these values can be relied upon for live product submissions.

### Diff checklist

- [ ] Field names match current Listing Management API spec?
- [ ] `allowedValues` for Colour, Size, Pattern etc. still valid?
- [ ] Any new required fields in current spec?
- [ ] Any fields deprecated or renamed?

### Outcome recording

Same as Meesho above. Remove `[NEEDS_PARTNER_CONFIRMATION]` annotations only after
partner confirmation is received and diff is complete.

**Sign-off required**: PO + Myntra account manager confirm field set is current.

---

## Connector 3: Nykaa

**Source file**: `apps/api/src/connectors/nykaa/nykaa-category-templates.ts`  
**Templates**: lipstick, foundation, skincare, haircare, personal-care, default  
**Current `templateVerifiedAt`**: `2026-06-11` (all marked `[NEEDS_PO_VERIFICATION from real seller account]`)

### Re-download process

1. Log in to [seller.nykaa.com](https://seller.nykaa.com) with a real seller account
2. Navigate to the catalog upload section
3. Download the current template for each category (Beauty & Personal Care)
4. Compare column headers and allowed values against current code

### Current template structure (code baseline)

**Shared base columns** (all categories):
SKU Code, Product Name, MRP, Selling Price, Brand, HSN Code, GST Rate (%),
Description, Country of Origin, Image URL 1–5

**Category-specific additions**:

| Category | Category-specific columns |
|----------|--------------------------|
| lipstick | Shade Name, Finish Type, Shade Family, Volume (ml), Skin Type |
| foundation | Shade Name, Coverage, Finish, SPF Level, Skin Type, Volume (ml) |
| skincare | Skin Type, Concern, Key Ingredients, SPF Level, Volume (ml/g) |
| haircare | Hair Type, Concern, Key Ingredients, Volume (ml/g), Application |
| personal-care | Sub-category, Gender, Volume (ml/g), Fragrance |
| default (Beauty & PC) | Sub-category, Volume (ml/g) |

**`[NEEDS_PO_VERIFICATION]` annotation meaning**: These templates were constructed from
publicly available Nykaa seller guidelines. Actual seller account verification is required.

### Diff checklist

- [ ] All existing column headers still present and correctly spelled?
- [ ] Any new required columns added?
- [ ] Any allowed-value enumerations changed?
- [ ] Any columns removed or renamed?

### Outcome recording

Same as Meesho above. Remove `[NEEDS_PO_VERIFICATION from real seller account]` annotations
only after real seller account verification is complete.

**Sign-off required**: PO confirms template comparison completed using real seller.nykaa.com account.

---

## Engineering action (upon PO/partner verification)

Once the PO/partner provides the diff outcomes for each connector:

1. Update `templateVerifiedAt` in the relevant template file to the verification date
2. If structure changed, update column/field definitions and bump schemaVersion
3. Remove `[NEEDS_PARTNER_CONFIRMATION]` / `[NEEDS_PO_VERIFICATION]` annotations if confirmed
4. Run: `node scripts/generate-connector-inventory.cjs` — expect 0 INFO schema-stale findings
5. Update INC-62 stories in `docs/execution/INCREMENT_STATE.json` to `completed`/`locked`

---

## ADR-0013 invariant: `stale-schema-has-review-plan`

This document satisfies the `stale-schema-has-review-plan` machine-checkable invariant
from ADR-0013 §4: all three connectors with `schema-template-stale` findings now have a
review plan. The findings will clear only after the actual verification updates are made
to the template files.

---
🤖 Generated with [Claude Code](https://claude.com/claude-code)

https://claude.ai/code/session_019Y4jS6bJx3tJS3w3MxQTUG
