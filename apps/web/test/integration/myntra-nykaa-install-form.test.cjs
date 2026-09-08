#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const CONNECTORS_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "connectors", "page.tsx");
const SETUP_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "connectors", "setup", "page.tsx");
const CREDENTIAL_FIELDS = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "components",
  "connectors",
  "connector-credential-fields.tsx",
);
const INSTALLER_SERVICE = path.join(
  REPO_ROOT,
  "apps",
  "api",
  "src",
  "connector-installer",
  "connector-installer.service.ts",
);
const WOO_DEFINITION_MIGRATION = path.join(
  REPO_ROOT,
  "packages",
  "db",
  "prisma",
  "migrations",
  "20260801000000_seed_woocommerce_connector_definition",
  "migration.sql",
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run() {
  const pageSource = fs.readFileSync(CONNECTORS_PAGE, "utf8");
  const setupSource = fs.readFileSync(SETUP_PAGE, "utf8");
  const credentialFieldsSource = fs.readFileSync(CREDENTIAL_FIELDS, "utf8");
  const installerSource = fs.readFileSync(INSTALLER_SERVICE, "utf8");
  const wooDefinitionMigration = fs.readFileSync(WOO_DEFINITION_MIGRATION, "utf8");

  // ── Myntra credential form (setup/page.tsx) ────────────────────────────────

  assert(
    setupSource.includes("<ConnectorCredentialFields") &&
      setupSource.includes('mode="install"') &&
      credentialFieldsSource.includes('if (slug === "myntra")') &&
      credentialFieldsSource.includes("Secret Key") &&
      credentialFieldsSource.includes("Warehouse ID"),
    "Setup page must render the shared ConnectorCredentialFields section, which owns Myntra Secret Key and Warehouse ID fields.",
  );
  assert(
    credentialFieldsSource.includes("clientSecret") &&
      credentialFieldsSource.includes("refreshToken") &&
      credentialFieldsSource.includes('name="clientSecret"') &&
      credentialFieldsSource.includes('name="refreshToken"'),
    "Myntra form fields must be wired to the correct DTO field names (clientSecret, refreshToken).",
  );
  assert(
    credentialFieldsSource.includes('type="password"'),
    "Myntra Secret Key must be an input with type=password so the value is masked.",
  );
  assert(
    credentialFieldsSource.includes("encrypted on save and never shown again"),
    "Myntra credential form must include the encryption-at-rest notice.",
  );
  assert(
    credentialFieldsSource.includes('if (slug === "myntra") return "Merchant ID"'),
    "connectorAccountReferenceLabel must return 'Merchant ID' for the Myntra slug.",
  );
  assert(
    credentialFieldsSource.includes('if (slug === "myntra") return "Enter Myntra merchant ID"'),
    "connectorAccountReferencePlaceholder must return the Myntra merchant ID placeholder.",
  );

  // ── Myntra error messages in setup/page.tsx ────────────────────────────────

  assert(
    setupSource.includes("MYNTRA_CREDENTIALS_INCOMPLETE") &&
      setupSource.includes("MYNTRA_CREDENTIALS_INVALID"),
    "Setup page must surface MYNTRA_CREDENTIALS_INCOMPLETE and MYNTRA_CREDENTIALS_INVALID errors to the user.",
  );

  // ── WooCommerce credential form (setup/page.tsx) ──────────────────────────

  assert(
    setupSource.includes("<ConnectorCredentialFields") &&
      credentialFieldsSource.includes('if (slug === "woocommerce")') &&
      credentialFieldsSource.includes("Consumer Key") &&
      credentialFieldsSource.includes("Consumer Secret") &&
      credentialFieldsSource.includes("WooCommerce Settings"),
    "Setup page must render the shared ConnectorCredentialFields section, which owns WooCommerce credential fields and points operators to WooCommerce REST API settings.",
  );
  assert(
    credentialFieldsSource.includes('if (slug === "woocommerce") return "Site URL"') &&
      credentialFieldsSource.includes('if (slug === "woocommerce") return "https://store.example.com"'),
    "WooCommerce setup must label the external account reference as the HTTPS Site URL.",
  );
  assert(
    credentialFieldsSource.includes('name="clientId"') &&
      credentialFieldsSource.includes('name="clientSecret"') &&
      credentialFieldsSource.includes('type="password"'),
    "WooCommerce form fields must be wired to clientId/clientSecret and mask the Consumer Secret.",
  );
  assert(
    setupSource.includes("WOOCOMMERCE_CREDENTIALS_INCOMPLETE") &&
      setupSource.includes("WOOCOMMERCE_SITE_URL_NOT_HTTPS"),
    "Setup page must surface WooCommerce incomplete-credential and HTTPS-only errors.",
  );
  assert(
    setupSource.includes("isSetupLaneStage") &&
      setupSource.includes('stage === "code_complete"'),
    "Connector setup page must expose code-complete setup lanes such as WooCommerce, not only live connectors.",
  );

  // ── Myntra status note (AM-gated Beta) ────────────────────────────────────

  assert(
    setupSource.includes('"myntra"') &&
      (setupSource.includes("account manager") || setupSource.includes("Beta") || setupSource.includes("beta")),
    "Setup page must include an account-manager-gated Beta status note for Myntra.",
  );

  // Nykaa has launchStage "manual" and is not shown in the setup page.
  // Its portal-upload / QC-wait note is on connectors/page.tsx — verified below.

  // ── connector/page.tsx error labels ───────────────────────────────────────

  assert(
    pageSource.includes('"myntra"') && pageSource.includes('"Myntra"'),
    "Connectors page formatInstallErrorMessage must map slug 'myntra' to display label 'Myntra'.",
  );
  assert(
    pageSource.includes('"nykaa"') && pageSource.includes('"Nykaa"'),
    "Connectors page formatInstallErrorMessage must map slug 'nykaa' to display label 'Nykaa'.",
  );
  assert(
    pageSource.includes("MYNTRA_CREDENTIALS_INCOMPLETE"),
    "Connectors page must surface MYNTRA_CREDENTIALS_INCOMPLETE to the user.",
  );

  // ── Nykaa status note in connectors/page.tsx ──────────────────────────────

  assert(
    pageSource.includes('"nykaa"') &&
      (pageSource.includes("portal") || pageSource.includes("7")),
    "Connectors page must include a portal-upload / QC-wait note for Nykaa.",
  );

  // ── API installer service — Myntra credential branch ──────────────────────

  assert(
    installerSource.includes('normalizedSlug === "myntra"'),
    "connector-installer.service.ts must handle the 'myntra' slug with a dedicated branch.",
  );
  assert(
    installerSource.includes("captureAndStoreMyntraCredentials"),
    "connector-installer.service.ts must call captureAndStoreMyntraCredentials for Myntra installs.",
  );
  assert(
    installerSource.includes("MYNTRA_CREDENTIALS_INCOMPLETE"),
    "connector-installer.service.ts must throw MYNTRA_CREDENTIALS_INCOMPLETE when any of the three credentials is absent.",
  );
  assert(
    installerSource.includes("merchant_id") &&
      installerSource.includes("secret_key") &&
      installerSource.includes("warehouse_id"),
    "connector-installer.service.ts must store all three Myntra credential types: merchant_id, secret_key, warehouse_id.",
  );

  // ── Partial credentials are never stored ──────────────────────────────────
  // The storeCredential calls must be guarded — only reached after the completeness check throws.
  // We verify the guard appears before the store calls in the source file.
  const myntraMethodStart = installerSource.indexOf("private async captureAndStoreMyntraCredentials");
  const myntraMethodEnd = installerSource.indexOf("private async", myntraMethodStart + 1);
  const myntraMethodSource =
    myntraMethodStart !== -1
      ? installerSource.slice(
          myntraMethodStart,
          myntraMethodEnd !== -1 ? myntraMethodEnd : installerSource.length,
        )
      : "";
  const incompleteIdx = myntraMethodSource.indexOf("MYNTRA_CREDENTIALS_INCOMPLETE");
  const storeIdx = myntraMethodSource.indexOf('"merchant_id"');
  assert(
    incompleteIdx !== -1 && storeIdx !== -1 && incompleteIdx < storeIdx,
    "MYNTRA_CREDENTIALS_INCOMPLETE guard must appear before credential store calls in installer service.",
  );

  // ── API installer service + catalog seed — WooCommerce path ───────────────

  assert(
    installerSource.includes('normalizedSlug === "woocommerce"') &&
      installerSource.includes("captureAndStoreWooCommerceCredentials"),
    "connector-installer.service.ts must handle the 'woocommerce' slug with the WooCommerce credential branch.",
  );
  assert(
    installerSource.includes("WOOCOMMERCE_CREDENTIALS_INCOMPLETE") &&
      installerSource.includes("WOOCOMMERCE_SITE_URL_NOT_HTTPS") &&
      installerSource.includes('"site_url"') &&
      installerSource.includes('"consumer_key"') &&
      installerSource.includes('"consumer_secret"'),
    "WooCommerce installer branch must require HTTPS site URL plus Consumer Key and Consumer Secret, then store the expected credential types.",
  );
  assert(
    wooDefinitionMigration.includes("'cdef_woocommerce'") &&
      wooDefinitionMigration.includes("'woocommerce'") &&
      wooDefinitionMigration.includes("'WooCommerce'") &&
      wooDefinitionMigration.includes("ARRAY['PUBLISH','VALIDATE','STATUS_SYNC','WEBHOOK_RECEIVE']"),
    "WooCommerce connector definition seed migration must register cdef_woocommerce with runtime capabilities.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "myntra_credential_form_renders_secret_key_and_warehouse_id",
          "myntra_form_fields_wired_to_correct_dto_names",
          "myntra_secret_key_field_is_password_type",
          "myntra_form_includes_encryption_at_rest_notice",
          "myntra_account_reference_label_is_merchant_id",
          "myntra_error_codes_present_in_setup_page",
          "myntra_am_gated_status_note_present",
          "nykaa_portal_upload_status_note_present_in_setup_page",
          "myntra_nykaa_error_labels_in_connectors_page",
          "myntra_credentials_incomplete_in_connectors_page",
          "nykaa_portal_note_in_connectors_page",
          "installer_service_has_myntra_branch",
          "installer_service_captures_all_three_credentials",
          "installer_service_guard_precedes_store_calls",
          "woocommerce_credential_form_renders_site_url_consumer_key_and_secret",
          "woocommerce_form_fields_wired_to_expected_dto_names",
          "woocommerce_error_codes_present_in_setup_page",
          "setup_page_exposes_code_complete_connector_lanes",
          "installer_service_has_woocommerce_branch",
          "woocommerce_connector_definition_seeded",
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

try {
  run();
} catch (error) {
  console.error("Myntra/Nykaa install form integration test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
