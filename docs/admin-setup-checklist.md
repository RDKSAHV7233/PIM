# TEJ PIM Admin Setup Checklist

This checklist is for workspace admins setting up a tenant in the current TEJ PIM application.

Use this document when you want a shorter, action-focused setup guide.
Use the full guide for detailed workflows: `docs/pim-user-guide.md`.

## Before You Start

Make sure you have:
1. an `admin` login for the correct workspace slug
2. the workspace slug used on the login screen
3. the connector credentials you plan to use
4. the category and attribute structure your catalog needs
5. product data or import files ready if you plan to onboard a catalog immediately

Important repo-truth notes:
1. Flipkart and Amazon India are live seller-ready connector paths in this repo today.
2. Amazon India install requires seller ID plus Amazon LWA credentials.
3. Meesho is still a guided/manual workflow, not a complete self-serve connector path.
4. ONDC is internal or feature-flagged.

If the workspace does not exist yet and public signup is enabled in your environment:
1. go to `/signup`
2. create the workspace and first admin
3. verify the email link
4. return to this checklist after signing in as admin

## 1. Sign In As Admin

Route: `/login`

1. Enter `Workspace`
2. Enter `User ID`
3. Enter `Password`
4. Confirm you can see `Settings` in the main navigation

If you cannot see `Users & Roles`, `Connector Access`, `Plan & Usage`, `Privacy`, or `Audit Logs`, you are probably not signed in as an admin.

Note:
1. a new self-serve workspace is not active until the verification email has been completed
2. the first admin created through `/signup` starts on the `STARTER` plan

## 2. Check Plan and Usage

Route: `/admin/plan`

1. Open `Settings -> Plan & Usage`
2. Review the current plan tier
3. Check the usage meters for:
   - `SKUs`
   - `Submissions`
   - `Storage (GB)`
   - `Users`
   - `Connector Installations`
   - `Accounts Per Connector`
4. If needed, update the plan tier before inviting users or installing connectors

Why this matters:
- plan limits can block connector installs, storage growth, and user creation

## 3. Invite Your Team

Route: `/admin/users`

1. Open `Settings -> Users & Roles`
2. Click `Invite User`
3. Enter `User ID`
4. Choose the starting role:
   - `Editor`
   - `Reviewer`
   - `Viewer`
5. Click `Create User`
6. If someone needs full admin access, promote them after creation by changing their role to `Admin`

What each role can do in practice:
1. `Admin`: full access, including plan, users, connector access, privacy, audit, API keys, and webhooks
2. `Editor`: create and update catalog data, run imports, work channel actions, and handle day-to-day operations
3. `Reviewer`: read catalog and quality surfaces, plus approve or reject products in review
4. `Viewer`: read-only access

## 4. Set Connector Access Rules

Route: `/admin/connectors`

1. Open `Settings -> Connector Access`
2. In `Grant Permission`, choose:
   - principal type: `user` or `role`
   - principal ID
   - connector slug
   - account alias if needed
   - action
3. Save the permission row
4. Review existing grants below the form
5. Revoke anything that is too broad

Current supported actions in the UI:
1. `install`
2. `reconnect`
3. `uninstall`

## 5. Create Categories

Route: `/catalog/categories`

1. Open `Catalog -> Categories`
2. Review the existing category tree
3. Use `Create Category` to add your required categories
4. Set a `Parent Category` when you need a hierarchy
5. Confirm the `Path` looks right in the category table

Important behavior:
1. Delete is blocked if a category has child categories or assigned products
2. This page is admin-managed taxonomy, not a merchandiser page

## 6. Add Attribute Definitions

Route: `/catalog/attributes`

1. Open `Catalog -> Attributes`
2. Select a category
3. Review the current definitions
4. In `Add Attribute Definition`, enter:
   - `Display Name`
   - `Key`
   - `Data Type`
   - `Applies To`
   - `Required`
   - `Allowed Values (JSON array)` if needed
5. Click `Add attribute`

Important limitation:
- the current UI supports adding definitions clearly, but it does not expose a full edit/delete workflow for existing definitions

## 7. Load Your First Products

Preferred route for a new catalog: `/operations/imports`

1. Open `Operations -> Imports`
2. Download a sample file if needed
3. Choose the target `Category`
4. Upload the source file
5. Click `Upload Import File`
6. In `Import Jobs`, click `Start import` for queued jobs
7. Repair failed rows if required

Accepted file types:
1. `.csv`
2. `.json`
3. `.xlsx`
4. `.xls`

Canonical import fields:
1. `title`
2. `description`
3. `brand`
4. `hsnCode`
5. `gstRate`
6. `status`
7. `attributes`

Important format rule:
- `attributes` must contain a JSON object for category-specific fields

Manual alternative:
- use `Products -> Product Workbench` and `+ New Product` to create products one by one

## 8. Upload Media

Route: `/catalog/media`

1. Open `Catalog -> Media`
2. Upload images for products or variants
3. If needed, use `Bulk Media Association (CSV)`
4. Run channel validation on uploaded assets

Bulk media CSV headers:
- `skuCode,imageUrl,contentBase64,fileName,mimeType,width,height`

## 9. Install the First Channel Connector

Route: `/channels/connectors`

1. Open `Channels -> Connectors`
2. Review `Available Connectors`
3. Install only a connector that is truly live in the current environment
4. For Flipkart, enter:
   - `Account Alias`
   - optional `External Account Ref`
   - `Client ID`
   - `Client Secret`
   - `Refresh Token`
5. Click `Install connector`
6. Confirm the connector appears in `Installed Connectors`

Important repo-truth notes:
1. Flipkart is the practical live connector path in this codebase
2. Amazon India is also live for seller self-serve install, publish, and status sync when valid seller credentials are provided
3. Meesho is not a finished self-serve connector workflow yet

## 10. Build and Publish a Mapping

Route: `/channels/mappings`

1. Open `Channels -> Mappings`
2. Choose the category and channel
3. Create a draft mapping version
4. Validate the draft
5. Publish the mapping version

Important behavior:
- protected mapping actions use step-up password confirmation

## 11. Validate Catalog Quality

Use these pages together:
1. `/quality/issues`
2. `/quality/validation`
3. `/quality/completeness`
4. `/quality/approvals`

Recommended first pass:
1. Open `Quality -> Issue Inbox`
2. Fix `BLOCKING` issues first
3. Review completeness scores
4. Send products through review if your workflow uses approvals
5. Approve products only when blocking issues are clear

Common blockers:
1. missing or invalid `HSN Code`
2. missing `GST Rate`
3. missing required category attributes
4. mapping not published
5. connector credentials missing

## 12. Queue the First Channel Job

Route: `/products/[id]?tab=channels`

1. Open a prepared product
2. Go to `Channels`
3. Review the readiness banner
4. Choose the target `Channel`
5. Choose the `Mapping`
6. Set `Max Retries`
7. Confirm fallback acknowledgement if required
8. Click `Queue channel export`
9. Monitor the outcome in:
   - `Channels -> Submissions`
   - `Operations -> Jobs`
   - `Operations -> Repair`

## 13. Optional Admin Integrations

### API keys
Route: `/admin/api-keys`

Use this when another system needs machine access.

Fields:
1. `Label`
2. `Role`
3. `Expires at`

Important behavior:
- the raw key is shown once only

### Outbound webhooks
Route: `/admin/webhooks`

Use this when another system needs event notifications.

Supported event types in the current codebase:
1. `import_completed`
2. `import_failed`
3. `publish_succeeded`
4. `publish_failed`
5. `approval_decision`

## 14. Privacy and Governance Checks

Routes:
1. `/admin/privacy`
2. `/admin/audit`

Privacy page supports:
1. account data export request
2. scheduled account deletion

Audit page helps admins review:
1. user management changes
2. catalog actions
3. channel and operational events

## First-Day Success Checklist

A tenant is reasonably set up when all of these are true:
- at least one admin and one working editor exist
- categories exist for the first product range
- required attributes exist for those categories
- at least one product is loaded
- media is uploaded for the first publish candidate
- Flipkart connector is installed if the tenant is using live marketplace flow
- a mapping is published for the target category
- no blocking quality issues remain on the first publish candidate
- the first submission can be queued and tracked

## Common Setup Problems

### I cannot see admin pages
- Confirm your role is `admin`
- Check you signed into the correct workspace slug

### I cannot install a connector
- Check `Settings -> Connector Access`
- Check `Settings -> Plan & Usage`
- For Flipkart, confirm all three credentials are present together

### My mapping will not publish
- Complete the step-up password confirmation
- Validate the draft first
- Check missing required field mappings

### Products imported but still cannot publish
- Run validation
- Check channel readiness blockers
- Confirm media and required attributes are present
- Confirm the mapping is published

## Related Docs

1. Full user guide: `docs/pim-user-guide.md`
2. First seller onboarding playbook: `docs/product/FIRST_SELLER_ONBOARDING_PLAYBOOK.md`
3. Product user-guide bundle: `docs/product/user-guide/`
4. API contract reference: `docs/openapi.yaml`
