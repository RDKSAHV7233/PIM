# Vexa PIM User Guide

Status: Detailed legacy guide retained for reference
Canonical replacement: `docs/user-guide.md`

This detailed guide is retained for workflow history and deeper operational notes. Use `docs/user-guide.md` as the current concise operator guide, and verify any detailed claim here against the current web routes and API controllers before release.

This guide explains how to use Vexa PIM as it exists in this repository today.

Audience:
- Primary: merchandising teams, eCommerce managers, onboarding staff, and support staff
- Secondary: technical admins who set up workspaces, channel access, API keys, and webhooks

This guide is based on the current Vexa PIM web routes, Prisma schema, API contracts, README, and product playbooks in the repo. If a workflow is not clearly implemented in code, it is called out as a limitation instead of being assumed.

## 1. Overview

### What Vexa PIM does

Vexa PIM is a multi-tenant Product Information Management system for central product data, catalog quality, channel readiness, and operational workflows.

In day-to-day use, teams can:
1. Create and edit products and variants.
2. Organize the catalog with categories and category-specific attributes.
3. Upload and validate product media.
4. Import products in bulk from CSV, JSON, and spreadsheet files.
5. Run bulk edits across many products.
6. Review quality issues, completeness, and approval queues.
7. Install channel connectors, configure mappings, and queue channel export or publish jobs.
8. Track submissions, retries, failures, and repair work.
9. Manage users, connector permissions, privacy requests, audit logs, API keys, and webhooks.

### Systems it connects to

Connector surfaces implemented in this repo are:
1. Flipkart
   - Current state: live
   - Supports installation, credential validation, publish, and status sync
2. Amazon India (`amazon-in`)
   - Current state: live
   - Supports seller installation, credential validation, publish, status sync, and webhook relay handling
3. Meesho
   - Current state: manual or guided workflow
   - Not seller self-serve and not direct publish
4. ONDC
   - Current state: internal or feature-flagged
   - Not part of the normal seller-facing navigation by default

Technical admin surfaces also support:
1. Tenant-scoped API keys for machine access
2. Outbound webhooks for event delivery to external HTTP endpoints

### Important product boundary

Vexa PIM includes both catalog management and operational channel workflows. However, not every route group in `apps/web/src/app` is fully seller-facing. The normal seller shell today is:
1. Dashboard
2. Products
3. Catalog
4. Channels
5. Quality
6. Operations
7. Settings

Internal surfaces such as `Labs / Internal`, `AI Lab`, `DAM`, and `ONDC` are hidden by default from normal production navigation.

## 2. Who This Guide Is For

### Primary users

1. Merchandisers
   - Create products, complete attributes, upload media, and fix validation issues
2. eCommerce managers
   - Review publish readiness, connector health, submissions, and approval queues
3. Onboarding and support staff
   - Help set up categories, attributes, connectors, mappings, and imports

### Secondary users

1. Technical admins
   - Manage plan, users, connector permissions, API keys, webhooks, privacy requests, and audit logs

### Actual user roles in the current app

The current web app uses these roles:
1. `admin`
2. `editor`
3. `reviewer`
4. `viewer`

Practical meaning in the current UI:
1. Admin
   - Full catalog, channel, operations, and admin control
2. Editor
   - Day-to-day write access across catalog, channels, operations, and quality work
3. Reviewer
   - Read access across catalog and channels, plus approval decisions in the review queue
4. Viewer
   - Read-only visibility

Note: the PRD also mentions Marketplace Ops as a user type, but the mounted app role model in code is the 4-role set above.

## 3. Key Concepts

### Products

A product is the main catalog record. The core fields used throughout the app are:
1. `title`
2. `description`
3. `brand`
4. `categoryId`
5. `hsnCode`
6. `gstRate`
7. `attributes`
8. `status`

Products move through a workflow status model that includes:
1. `draft`
2. `in_review`
3. `approved`
4. `rejected`
5. `active`
6. `archived`

### Variants

Variants are child records for a product. The main fields are:
1. `skuCode`
2. `attributes`
3. `mrp`
4. `sellingPrice`
5. `inventoryQty`
6. `status`

### Categories

Categories define where a product belongs in the catalog. Each category has:
1. `name`
2. `slug`
3. `path`
4. optional parent-child hierarchy

### Attribute definitions

Attributes are category-level fields that can be required or optional.

Each definition includes:
1. `key`
2. `name`
3. `dataType`
4. `required`
5. `allowedValues`
6. `appliesTo` (`product` or `variant`)

### Validation issues

Validation issues are quality problems found on products or variants.

They are shown with:
1. severity: `error` or `warning`
2. rule code
3. message
4. field path
5. status: `open` or `resolved`

In the seller-facing issue inbox, severity is presented as:
1. `BLOCKING`
2. `WARNING`

### Completeness

Completeness is a quality score based on core product fields and required category attributes. It helps teams decide what to fix first before publishing.

### Channels and connectors

A channel connector links Vexa PIM to an external destination such as Flipkart. Connectors have:
1. a slug such as `flipkart`, `amazon-in`, or `meesho`
2. a display name
3. capabilities such as publish, validate, or status sync
4. a launch stage such as `live`, `manual`, or `planned`
5. an implementation status such as `full`, `partial`, or `stub`

### Mappings

Mappings connect your PIM category and attributes to channel-specific fields. In the current UI, mappings are versioned and move through a lifecycle:
1. draft
2. validated
3. published
4. rolled back or archived when needed

### Submissions and jobs

After a product is ready, channel jobs and submissions track the publish or export attempt. These show:
1. current status
2. attempt count
3. errors or dead-letter state
4. retry and repair follow-up

## 4. Access and Prerequisites

### User access

To sign in to Vexa PIM, a user needs:
1. workspace slug
2. user ID or email
3. password
4. access to password reset or unlock recovery if needed

The login screen uses:
1. `Workspace`
2. `User ID`
3. `Password`

### Self-serve workspace signup

If public signup is enabled in your deployment, a new customer can create a workspace without operator intervention.

Route: `/signup`

Current implemented flow:
1. enter `Workspace name`
2. enter `Workspace ID`
3. enter the first admin email
4. create a password
5. accept Terms and Privacy
6. submit the signup request
7. open the verification email
8. use the verification link to activate the workspace
9. sign in at `/login` with:
   - `Workspace`
   - `User ID`
   - `Password`

Important repo-truth notes:
1. signup is feature-flagged, so some environments may not expose `/signup`
2. the workspace is not created until the verification link is used
3. the first workspace admin lands on the `STARTER` plan by default
4. v1 signup is one email per workspace account

### Permissions you may need

Common permissions are role-based.

Examples:
1. Admin is required for user management, plan changes, connector access, API keys, webhooks, and most governance tasks.
2. Editors can create and update products, imports, bulk edits, media uploads, and channel actions.
3. Reviewers can work the approval queue but do not get full write access everywhere.
4. Viewers are read-only.
5. Some protected actions, such as publishing mappings, require a step-up password confirmation during the action.

### Business prerequisites before channel work

Before you try to publish or queue a channel job, make sure you have:
1. a product with category, pricing, tax fields, and required attributes filled
2. at least one installed connector for the target channel
3. published channel mappings for the relevant category
4. any required media uploaded
5. no blocking issues in validation or readiness

### Connector credentials and dependencies

Current connector setup requirements visible in the repo are:
1. Flipkart live install requires:
   - `Client ID`
   - `Client Secret`
   - `Refresh Token`
2. Amazon India live install requires:
   - `Seller ID`
   - `Client ID`
   - `Client Secret`
   - `Refresh Token`
3. Meesho is still treated as a guided manual workflow, not self-serve live publishing

### Technical setup for local or self-hosted environments

If you are a technical admin setting up the repo locally, use the README flow:
1. Copy `.env.example` to `.env`
2. Run `npm install`
3. Start infrastructure with `npm run infra:up`
4. Generate Prisma client with `npm run prisma:generate`
5. Apply schema with `npm run prisma:migrate:deploy`
6. Bootstrap an admin with `npm run auth:bootstrap-admin`
7. Start the API with `npm run dev:api`
8. Start the web app with `npm run dev:web`

Important environment areas from `.env.example`:
1. database and Redis
2. auth mode and JWT secrets
3. R2 media storage
4. connector credentials and feature flags

## 5. Initial Setup

### A. Set up the workspace basics

Recommended first-time setup order for a new tenant:
1. If public signup is enabled and the workspace does not exist yet, create it from `/signup`
2. Confirm the plan tier in `Settings -> Plan & Usage`
3. Invite users in `Settings -> Users & Roles`
4. Review connector permissions in `Settings -> Connector Access`
5. Create categories in `Catalog -> Categories`
6. Add attribute definitions in `Catalog -> Attributes`
7. Create the first products or import a catalog
8. Install the live channel connector you plan to use
9. Build and publish channel mappings
10. Upload media and run validation

### B. Create categories

Route: `/catalog/categories`

Admin access is required to create or delete categories.

What you can do today:
1. view categories
2. create a category
3. delete a category when it has no child categories and no assigned products

Steps:
1. Open `Catalog -> Categories`
2. Review the category table and existing paths
3. Click into the `Create Category` form
4. Enter `Category Name`
5. Choose `Parent Category` if needed
6. Click `Create category`

UX notes:
1. The page shows child counts and product counts.
2. Delete is blocked if the category still has children or products.

### C. Add attribute definitions

Route: `/catalog/attributes`

Admin access is required to add attribute definitions.

What you can do today:
1. filter by category
2. view existing attribute definitions
3. add a new attribute definition

Steps:
1. Open `Catalog -> Attributes`
2. Choose a `Category`
3. Review existing definitions in the table
4. In `Add Attribute Definition`, enter:
   - `Display Name`
   - `Key`
   - `Data Type`
   - `Applies To`
   - `Required`
   - `Allowed Values (JSON array)` if needed
5. Click `Add attribute`

Current limitation:
1. The current UI clearly supports adding definitions, but it does not show a full edit/delete workflow for existing definitions.

### D. Invite users

Route: `/admin/users`

Admin access is required.

Steps:
1. Open `Settings -> Users & Roles`
2. Click `Invite User`
3. Enter `User ID`
4. Choose a starting `Role`:
   - `Editor`
   - `Reviewer`
   - `Viewer`
5. Click `Create User`

After users exist, admins can:
1. change role
2. lock for 60 minutes
3. unlock
4. deactivate

Important behavior:
1. New users are invited first as `Editor`, `Reviewer`, or `Viewer`.
2. `Admin` is assigned later by changing the role after the user record exists.

### E. Install a channel connector

Route: `/channels/connectors`

Steps:
1. Open `Channels -> Connectors`
2. Review `Available Connectors`
3. Look at each connector's launch status and note
4. For a connector that is truly live and allowed for self-serve install, enter:
   - `Account Alias`
   - optional `External Account Ref`
   - any connector-specific credentials shown by the form
5. Click `Install connector`

Current repo-truth note:
1. Self-serve install is intentionally hidden for connectors that are not operationally ready.
2. In the current codebase, Flipkart is the practical live connector.
3. Amazon India and Meesho show honest status messaging instead of pretending they are fully ready.

### F. Build a mapping

Route: `/channels/mappings`

This is the canonical mapping workspace.

Steps:
1. Open `Channels -> Mappings`
2. Choose `Category`
3. Choose `Channel`
4. Set `Mapping type`
5. Review `Taxonomy search` and unmapped categories
6. Enter mapping details such as:
   - `Category scope`
   - `Publish category`
   - `Channel compatibility`
   - fallback settings if needed
7. Create a draft mapping version
8. Validate it
9. Publish it

Important UX note:
1. Publishing uses `Step-up re-authentication`, so expect to enter your password again for protected mapping actions.

## 6. Product Management Workflows

### A. Open the main product workspace

Route: `/catalog/products`

This is the daily workbench for catalog teams.

What you see:
1. filter chips: `All`, `Needs Attention`, `Ready`
2. triage badges: `Needs Attention`, `At Risk`, `Ready`
3. search box: `Search products by title or SKU`
4. quick links like `Open Issue Inbox` and `Open channel mappings`
5. `+ New Product`
6. `Hide test data`

### B. Create a product

Route: `/catalog/products`

Steps:
1. Click `+ New Product`
2. Fill in:
   - `Product Title`
   - `Brand`
   - `Description`
   - `HSN Code`
   - `GST Rate`
   - `MRP`
   - `Selling Price`
   - `Category`
3. After choosing a category, fill the category attributes shown under `Category Attributes`
4. Submit the form

Important behavior:
1. New products always start in `draft`.
2. Category attributes are shown with proper inputs based on their definition, so product creation does not expose raw JSON for normal product attributes.

### C. Edit a product

Route: `/products/[id]`

The product detail page is organized into tabs:
1. Overview
2. Content
3. Attributes
4. Variants
5. Media
6. Channels
7. Quality
8. Activity

Use the `Content` or `Attributes` tabs to edit:
1. `Product Title`
2. `Brand`
3. `Description`
4. `HSN Code`
5. `GST Rate`
6. `Status`
7. category-specific `Additional Attributes`

Important behavior:
1. The edit form is versioned and submits with an expected product version.
2. Product editing is read-only for non-write roles.

### D. Manage variants

Route: `/products/[id]?tab=variants`

Steps:
1. Open the product
2. Go to `Variants`
3. In `Add Variant`, enter:
   - `SKU Code`
   - `Inventory Quantity`
   - `MRP`
   - `Selling Price`
   - `Status`
   - `Variant Attributes`
4. Click `Create variant`

Important limitation:
1. `Variant Attributes` currently uses a free text area rather than a fully structured form.
2. This is implemented, but it is more technical than the product-level attribute editor.

### E. Upload and manage media

Route: `/catalog/media`

You can:
1. upload a media asset
2. associate media to a product or variant
3. bulk associate by CSV
4. run channel media validation

Upload steps:
1. Open `Media`
2. In `Upload Media`, choose:
   - `Product`
   - optional `Variant ID`
   - `Image File`
   - optional `Width`
   - optional `Height`
3. Click `Upload media`

Bulk association steps:
1. Use the `Bulk Media Association (CSV)` form
2. Paste CSV with headers:
   - `skuCode,imageUrl,contentBase64,fileName,mimeType,width,height`
3. Use either `contentBase64` or `imageUrl`
4. Click `Run bulk association`

Validation steps:
1. In the asset table, click `Validate`
2. Choose a channel
3. Click `Run validation`
4. Review the result, rules, issues, and warnings

### F. Use the notification drawer

The top navigation includes a notifications bell.

You can:
1. open recent notifications
2. mark all read
3. open the linked record directly

The drawer currently surfaces import, publish, and approval updates and refreshes itself automatically.

## 7. Data Import and Export

### A. Import products in bulk

Route: `/operations/imports`

What the page supports today:
1. upload import files
2. download sample CSV and JSON files
3. view import job status
4. start queued jobs
5. repair failed rows

Accepted file types:
1. `.csv`
2. `.json`
3. `.xlsx`
4. `.xls`

Canonical fields for import:
1. `title`
2. `description`
3. `brand`
4. `hsnCode`
5. `gstRate`
6. `status`
7. `attributes`

Important format rule:
1. `attributes` must contain a JSON object for category-specific fields.

Steps:
1. Open `Operations -> Imports`
2. Download a sample file if needed
3. Choose `Category`
4. Choose `Source File`
5. Review or adjust `Chunk Size`
6. Review or adjust `Max Retries`
7. Click `Upload Import File`
8. In `Import Jobs`, click `Start import` for queued jobs
9. If rows fail, open `View rows` and use `Save and retry this row` in the repair console

### B. Export or publish to a channel

Route: `/products/[id]?tab=channels`

What is implemented:
1. queue channel export or publish jobs from a product
2. process and requeue export jobs
3. track results in `Channels -> Submissions` and `Operations -> Jobs`

Steps:
1. Open the product
2. Go to `Channels`
3. Review the readiness banner first
4. If ready, complete the form:
   - `Channel`
   - `Mapping`
   - `Max Retries`
   - `Fallback confirmation`
5. Click `Queue channel export`
6. Monitor the job and submissions views

Important repo-truth note:
1. This workflow is only practical for connectors that are truly publish-capable in the current build.
2. In the current codebase, Flipkart is the live path.
3. Amazon India is not wired for live seller publishing.
4. Meesho remains a guided manual workflow and is not a completed self-serve export path in the current repo.

### C. Account privacy export

Route: `/admin/privacy`

This is separate from product export. It is for account privacy records.

Users can:
1. request an account export in `JSON` or `CSV`
2. return later to download it when ready
3. schedule account deletion

## 8. Channel and Integration Setup

### A. Connector setup flow

Route: `/channels/connectors`

The page is split into:
1. `Available Connectors`
2. `Installed Connectors`

For each connector, review:
1. launch stage
2. auth method
3. capabilities
4. installed account count
5. seller-facing note or limitation

Installed connector actions can include:
1. `Details`
2. `Mapping`
3. `Reconnect`
4. `Disable`
5. `Delete Record` after disable and admin confirmation

### B. Field mapping flow

Route: `/channels/mappings`

This is the only editable mapping workspace in the current UX.

Use it to:
1. search connector taxonomy
2. find unmapped categories
3. create mapping versions
4. validate mapping versions
5. publish mapping versions
6. rollback or archive versions when needed

Important UX detail:
1. Legacy connector-specific mapping routes redirect into this canonical workspace.

### C. Connector access control

Route: `/admin/connectors`

Admins can grant connector actions to users or roles.

Current supported permission actions are:
1. `install`
2. `reconnect`
3. `uninstall`

Steps:
1. Open `Settings -> Connector Access`
2. In `Grant Permission`, choose:
   - principal type: user or role
   - principal ID
   - connector slug
   - account alias if needed
   - action
3. Save the permission row
4. Review or revoke permissions from the table below

### D. API keys for machine integrations

Route: `/admin/api-keys`

Admins can create tenant-scoped API keys.

Fields:
1. `Label`
2. `Role`
3. `Expires at` (optional)

Important behavior:
1. The raw key is shown once only.
2. Existing keys can be revoked.

### E. Outbound webhooks

Route: `/admin/webhooks`

Admins can send event notifications to external HTTP endpoints.

Supported event types in the current codebase are:
1. `import_completed`
2. `import_failed`
3. `publish_succeeded`
4. `publish_failed`
5. `approval_decision`

Create endpoint fields:
1. `Name`
2. `Event`
3. `Target URL`
4. `Signing secret`

Actions:
1. create webhook
2. send test
3. pause or resume
4. delete
5. review recent deliveries

## 9. Publishing and Sync Behavior

### A. What happens before publish

Before queueing a channel export or publish job, Vexa PIM runs readiness checks. In the current implementation, blockers can include:
1. connector not installed
2. connector credentials missing
3. mapping not published
4. field mappings missing
5. required attributes missing
6. fallback acknowledgement required
7. connector health or circuit-breaker blockers

### B. How to check readiness

Use these places together:
1. `Channels` tab on product detail
2. `Channels -> Health`
3. `Quality -> Issue Inbox`
4. `Quality -> Validation`

On product detail, the channels tab shows:
1. queue readiness
2. blockers and warnings
3. simulator results
4. mapped payload preview

### C. What syncs today

Current repo-truth summary:
1. Flipkart
   - installation supported
   - credential validation supported
   - publish supported
   - status sync supported
2. Amazon India
   - honest roadmap surface only
   - not live for seller self-serve publish
3. Meesho
   - manual or guided workflow only
   - not direct publish in the current implementation

### D. Where to monitor outcomes

Use these pages:
1. `Channels -> Submissions`
2. `Operations -> Jobs`
3. `Operations -> Repair`
4. notifications drawer in the top bar

## 10. Common Tasks

### A. Fix products that are blocking channel work

1. Open `Dashboard`
2. Click `Fix Issues` or open `Quality -> Issue Inbox`
3. Filter for `BLOCKING` issues if needed
4. Click `Fix Now` on a product
5. Update the product in `Content`, `Attributes`, `Variants`, or `Media`
6. Return to `Quality` and run validation again

### B. Approve or reject products in review

Route: `/quality/approvals`

1. Open `Quality -> Approval Queue`
2. Review issue counts and completeness
3. Open the product if more context is needed
4. Click `Approve` when there are no blocking issues
5. Click `Reject` when the product should move back instead of progressing

### C. Update prices or inventory

You can do this in two ways today.

Product detail route:
1. Open the product
2. Go to `Variants`
3. update or create the correct variant values

Bulk update route:
1. Open `Operations -> Bulk Edit`
2. filter by category, status, brand, or product IDs
3. enter a JSON object in `Updates`
4. click `Preview affected products`
5. review the diff preview
6. apply the change

Important limitation:
1. Bulk Edit is implemented, but the `Updates` input is raw JSON. It is best used by trained admins or support staff.

### D. Import a new catalog file

1. Open `Operations -> Imports`
2. download the sample file if needed
3. upload the file with the correct canonical columns
4. start the queued import job
5. repair failed rows if the job needs attention

### E. Change a user's role or lock access

1. Open `Settings -> Users & Roles`
2. find the user in `Workspace Users`
3. change the role and click `Save`, or use:
   - `Lock 60m`
   - `Unlock`
   - `Deactivate`

### F. Review plan usage

1. Open `Settings -> Plan & Usage`
2. review meters for:
   - SKUs
   - Submissions
   - Storage (GB)
   - Users
   - Connector Installations
   - Accounts Per Connector
3. if you are an admin, change the plan tier if required

### G. Search and triage products quickly

1. Open `Products -> Product Workbench`
2. use the filter chips `All`, `Needs Attention`, or `Ready`
3. search by title or SKU
4. keep `Hide test data` enabled unless you specifically need test records
5. use the triage counts and onboarding prompts at the top of the page

## 11. Troubleshooting

### Login and account access

#### Error: invalid credentials

What it usually means:
1. wrong workspace slug
2. wrong user ID or email
3. wrong password

What to do:
1. confirm the workspace slug
2. retry carefully
3. if repeated attempts are failing, use password reset before the lockout limit is hit

#### Rate limited sign-in

What it looks like:
1. login shows a retry countdown after too many attempts

What to do:
1. wait for the countdown to finish
2. avoid repeated retries during the lock period

#### Account locked

Route: `/login/locked`

What you can do:
1. click `Resend unlock`
2. use the link back to login after the lock expires
3. ask an admin to unlock the account if needed

#### Password reset

Route: `/login/reset`

What you can do:
1. request a reset email from the reset page
2. open the link with the token
3. set a new password

Known reset errors:
1. `PASSWORD_RESET_TOKEN_INVALID`

#### Signup verification link invalid or expired

Route: `/signup/verify`

What it means:
1. the verification token has already been used
2. the token expired before activation
3. the link was copied incorrectly

What to do:
1. open the verify page again if the full link was not used the first time
2. use `Resend verification email`
3. then sign in only after verification succeeds

### Product and quality issues

#### Blocking issues in Issue Inbox

What it means:
1. the product cannot move cleanly toward publish until the issue is fixed

What to do:
1. open `Quality -> Issue Inbox`
2. click `Fix Now`
3. correct the product data
4. run validation again from the product page

#### Warning issues in Issue Inbox

What it means:
1. the product is not fully clean, but the issue is not a hard blocker

What to do:
1. you can resolve warnings in bulk using `Resolve selected warnings`
2. blocking issues still need product-level fixes

#### Common product-quality causes

Based on the implemented validation model, common causes include:
1. missing or invalid `HSN Code`
2. missing `GST Rate`
3. missing required category attributes
4. compliance rule failures

### Import issues

#### Import job is still queued

What to do:
1. open `Operations -> Imports`
2. find the job
3. click `Start import`

#### Rows failed or reached dead letter

What to do:
1. click `View rows`
2. open the `Row Repair Console`
3. edit the suggested field values
4. click `Save and retry this row`

### Connector and readiness issues

#### Flipkart install requires more credentials

Known error:
1. `FLIPKART_CREDENTIALS_INCOMPLETE`

Meaning:
1. client ID, client secret, and refresh token must be provided together

#### Flipkart credentials invalid

Known error:
1. `FLIPKART_CREDENTIALS_INVALID`

Meaning:
1. the saved credentials could not be validated

#### Amazon install requires more credentials

Known error:
1. `AMAZON_CREDENTIALS_INCOMPLETE`

Meaning:
1. seller ID, client ID, client secret, and refresh token must be provided together

#### Amazon credentials invalid

Known error:
1. `AMAZON_CREDENTIALS_INVALID`

Meaning:
1. the saved seller ID or Amazon LWA credentials could not be validated

#### Action blocked by permission or plan

Examples shown in UI:
1. connector permission required
2. plan connector installations limit exceeded
3. plan accounts per connector limit exceeded

What to do:
1. check `Settings -> Connector Access`
2. check `Settings -> Plan & Usage`

#### Readiness blocker examples

Real blocker labels in the repo include:
1. `mapping_not_published`
2. `field_mappings_missing`
3. `fallback_ack_required`
4. `connector_not_installed`
5. `connector_credentials_missing`
6. `required_attributes_missing:<fields>`

What to do:
1. fix mappings in `Channels -> Mappings`
2. fix product data in the product page
3. acknowledge fallback only when appropriate
4. reconnect or install the connector if needed

### Media issues

What to do when media validation fails:
1. open `Media`
2. run `Validate` for the asset on the target channel
3. review dimension, aspect ratio, and quality issues
4. upload a corrected asset if required

### Privacy and account data issues

#### Export request queued but not ready yet

What to do:
1. open `Settings -> Privacy`
2. review `Current privacy status`
3. wait for the background export to complete
4. use `Download export` when it becomes available

#### Account deletion request

What to do:
1. enter `DELETE` exactly
2. review the scheduled deletion time returned by the system

## 12. Known Limitations

These are current product limitations that are visible in the codebase today.

1. Older local runbooks may still call Amazon India planned.
   - Replace them with the current repo truth: Amazon India ships a live install, publish, status sync, and webhook relay path.
2. Meesho is still a guided manual workflow.
   - The repo does not provide a complete self-serve Meesho export or direct publish flow today.
3. ONDC is internal or feature-flagged.
   - It is not part of the standard seller navigation by default.
4. Category management is partial.
   - The UI supports create and guarded delete, but not a full category edit workflow.
5. Attribute definition management is partial.
   - The UI clearly supports adding definitions, but not a full edit/delete surface.
6. Bulk Edit is powerful but technical.
   - Updates are entered as raw JSON.
7. Variant attributes are still technical.
   - The variant form uses a text area rather than a fully structured editor.
8. Workspace Settings is mostly a signpost page.
   - The main workspace controls live in Plan, Connector Access, Users, Privacy, and Audit.
9. Some advanced admin pages are not in the main left sidebar.
   - `API Keys` and `Outbound Webhooks` are accessed from `/admin` or direct URL.

## 13. FAQ

### Is Vexa PIM the main place to manage my catalog?

Yes. In this repo, Vexa PIM includes the product workbench, categories, attributes, media, imports, quality, and channel operations.

### Which channels are ready today?

Based on the current repo state:
1. Flipkart is the live connector path.
2. Amazon India is also a live connector path with seller install, credential validation, publish, and status sync.
3. Meesho is manual or guided, not a completed self-serve channel flow.

### Can I publish directly to Amazon India today?

Yes. Amazon India is wired as a live seller publishing flow in the current codebase when the installation has seller ID and valid Amazon LWA credentials.

### Can I use Meesho today?

Only in a guided manual sense. The product communicates that Meesho is not a standard self-serve live connector yet.

### Can I bulk import products?

Yes. Use `Operations -> Imports` and follow the canonical column format.

### Can I bulk update products?

Yes. Use `Operations -> Bulk Edit`, but note that updates are entered as a JSON object.

### Can I upload media in bulk?

Yes. Use `Media -> Bulk Media Association (CSV)` with the required headers.

### Can reviewers approve products?

Yes. The review queue and final decision flow are implemented in `Quality -> Approval Queue`.

### Can viewers edit products?

No. Viewer access is read-only.

### Can users reset their own password?

Yes. The login flow includes password reset and locked-account recovery pages.

### Can a new customer create a workspace without admin help?

Yes, if public signup is enabled in that environment. Use `/signup`, verify the email link, then sign in with the workspace ID and admin credentials you created.

### Can users request account data export and deletion?

Yes. The Privacy page supports account export requests and scheduled deletion.

### Can admins issue API keys and webhooks?

Yes. Those screens exist under `/admin/api-keys` and `/admin/webhooks`.

## Open Questions / Needs Confirmation

These items are not blockers for using the current app, but they are worth confirming in each deployment:

1. Whether your production deployment exposes `/admin/api-keys` and `/admin/webhooks` in navigation, or whether users reach them through `/admin` only.
2. Which connectors are enabled for your tenant in the current environment, since launch-stage and access rules can be tenant-specific.
3. Whether your team wants a non-JSON wrapper for Bulk Edit and variant attributes, since the current UI is functional but more technical in those two places.
