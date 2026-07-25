#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const SERVICE_FILE = path.join(REPO_ROOT, "apps", "api", "src", "marketplace", "connector-mapping.service.ts");
const CONTROLLER_FILE = path.join(REPO_ROOT, "apps", "api", "src", "marketplace", "marketplace.controller.ts");
const DTO_FILE = path.join(REPO_ROOT, "apps", "api", "src", "marketplace", "dto", "connector-mapping.dto.ts");
const ACTIONS_FILE = path.join(REPO_ROOT, "apps", "web", "src", "app", "actions.ts");
const CHANNELS_API_FILE = path.join(REPO_ROOT, "apps", "web", "src", "lib", "api", "channels.ts");
const EDITOR_FILE = path.join(REPO_ROOT, "apps", "web", "src", "components", "channel", "mapping-editor.tsx");
const VERSION_MANAGER_FILE = path.join(REPO_ROOT, "apps", "web", "src", "components", "channel", "version-manager.tsx");
const PAGE_FILE = path.join(REPO_ROOT, "apps", "web", "src", "app", "channels", "mappings", "page.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const service = fs.readFileSync(SERVICE_FILE, "utf8");
  const controller = fs.readFileSync(CONTROLLER_FILE, "utf8");
  const dto = fs.readFileSync(DTO_FILE, "utf8");
  const actions = fs.readFileSync(ACTIONS_FILE, "utf8");
  const channelsApi = fs.readFileSync(CHANNELS_API_FILE, "utf8");
  const editor = fs.readFileSync(EDITOR_FILE, "utf8");
  const versionManager = fs.readFileSync(VERSION_MANAGER_FILE, "utf8");
  const page = fs.readFileSync(PAGE_FILE, "utf8");

  // ── 1. UI create-draft carries installationId ──────────────────────────
  assert(
    editor.includes('name="installationId"'),
    "MappingEditorCard must include a hidden installationId field.",
  );
  assert(
    actions.includes('installationId: installationId || undefined,') &&
    actions.includes('postJsonForAction(formData, `/marketplace/connectors/${encodeURIComponent(connectorSlug)}/mappings/versions`'),
    "createConnectorMappingVersionAction must send installationId in the API body.",
  );
  assert(
    channelsApi.includes("installationId?: string;") &&
    channelsApi.includes("createConnectorMappingVersion"),
    "createConnectorMappingVersion web API helper must accept installationId in its body type.",
  );

  // ── 2. UI publish carries installationId ───────────────────────────────
  assert(
    versionManager.includes('installationId?: string;') &&
    versionManager.includes('name="installationId"'),
    "VersionManagerCard / ProtectedMappingActionForm must include installationId hidden field.",
  );
  assert(
    /publishConnectorMappingVersionAction[\s\S]*?installationId: installationId \|\| undefined/.test(actions),
    "publishConnectorMappingVersionAction must send installationId to the API.",
  );

  // ── 3. Publish promotes draftInstallationId to installationId ──────────
  assert(
    service.includes("selected.draftInstallationId ? { installationId: selected.draftInstallationId }"),
    "publishVersion must promote draftInstallationId to installationId in the publish update.",
  );

  // ── 4. Resolve API accepts installationId ──────────────────────────────
  assert(
    dto.includes("class ResolveConnectorMappingQueryDto") &&
    /ResolveConnectorMappingQueryDto[\s\S]*?installationId\?: string/.test(dto),
    "ResolveConnectorMappingQueryDto must include optional installationId field.",
  );
  assert(
    controller.includes("installationId: query.installationId") &&
    controller.includes("resolveEffectiveMapping"),
    "Controller must pass query.installationId to resolveEffectiveMapping.",
  );
  assert(
    /resolveConnectorMapping\(\s*\n?\s*connectorSlug:\s*string,\s*\n?\s*categoryScope:\s*string,\s*\n?\s*installationId\?:\s*string/.test(channelsApi),
    "resolveConnectorMapping web API helper must accept installationId parameter.",
  );

  // ── 5. Redirect sanitization on high-risk actions ──────────────────────
  assert(
    /publishConnectorMappingVersionAction[\s\S]*?sanitizePath\(/.test(actions),
    "publishConnectorMappingVersionAction must sanitize redirectTo with sanitizePath().",
  );
  assert(
    /archiveConnectorMappingVersionAction[\s\S]*?sanitizePath\(/.test(actions),
    "archiveConnectorMappingVersionAction must sanitize redirectTo with sanitizePath().",
  );
  assert(
    /rollbackConnectorMappingVersionAction[\s\S]*?sanitizePath\(/.test(actions),
    "rollbackConnectorMappingVersionAction must sanitize redirectTo with sanitizePath().",
  );

  // ── 6. Category scope locked after Step 1 ──────────────────────────────
  assert(
    editor.includes('name="categoryScope"') && editor.includes("readOnly"),
    "MappingEditorCard categoryScope input must be readOnly to prevent drift after Step 1.",
  );

  // ── 7. Version history filtered by installationId ──────────────────────
  assert(
    /ListConnectorMappingVersionsQueryDto[\s\S]*?installationId\?: string/.test(dto),
    "ListConnectorMappingVersionsQueryDto must include optional installationId filter.",
  );
  assert(
    /listVersions[\s\S]*?installationId\?: string/.test(service),
    "listVersions service method must accept installationId filter.",
  );
  assert(
    service.includes("input.installationId ? { installationId: input.installationId }"),
    "listVersions must apply installationId filter in the Prisma where clause.",
  );

  // ── 8. Page passes installationId through key data flows ───────────────
  assert(
    page.includes("installationId={selectedInstallationId || undefined}"),
    "Page must pass installationId to MappingEditorCard and VersionManagerCard.",
  );
  assert(
    page.includes("installationId: selectedInstallationId || undefined, includeArchived"),
    "Page must pass installationId when fetching versions.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "ui_create_draft_carries_installation_id",
          "ui_publish_carries_installation_id",
          "publish_promotes_draft_installation_id",
          "resolve_api_accepts_installation_id",
          "redirect_sanitization_on_high_risk_actions",
          "category_scope_locked_after_step_1",
          "version_history_filtered_by_installation_id",
          "page_passes_installation_id_through_data_flows",
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
  console.error("Account scope contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
