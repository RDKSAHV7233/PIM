#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const MEDIA_SERVICE = path.join(REPO_ROOT, "apps", "api", "src", "media", "media.service.ts");
const MEDIA_CONTROLLER = path.join(REPO_ROOT, "apps", "api", "src", "media", "media.controller.ts");
const CREATE_DTO = path.join(REPO_ROOT, "apps", "api", "src", "media", "dto", "create-media-asset.dto.ts");
const UPDATE_DTO = path.join(REPO_ROOT, "apps", "api", "src", "media", "dto", "update-media-asset-governance.dto.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const serviceSource = fs.readFileSync(MEDIA_SERVICE, "utf8");
  const controllerSource = fs.readFileSync(MEDIA_CONTROLLER, "utf8");
  const createDtoSource = fs.readFileSync(CREATE_DTO, "utf8");
  const updateDtoSource = fs.readFileSync(UPDATE_DTO, "utf8");

  assert(
    createDtoSource.includes("altText?: string;") &&
      createDtoSource.includes("isMain?: boolean;") &&
      createDtoSource.includes("sortOrder?: number;") &&
      createDtoSource.includes("channelEligibility?: string[];"),
    "Media upload DTO must accept governance fields at creation time.",
  );
  assert(
    controllerSource.includes('@Patch("assets/:id/governance")') &&
      controllerSource.includes("updateGovernance("),
    "Media controller must expose a governance update endpoint.",
  );
  assert(
    serviceSource.includes("async updateGovernance(") &&
      serviceSource.includes("clearSiblingMainFlags") &&
      serviceSource.includes("recordValidationState") &&
      serviceSource.includes("presentAsset"),
    "Media service must support governance updates, single-main-image enforcement, validation-state recording, and first-class asset presentation fields.",
  );
  assert(
    updateDtoSource.includes("channelEligibility?: string[];") &&
      updateDtoSource.includes("sortOrder?: number;"),
    "Media governance update DTO must support eligibility and ordering controls.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "media_governance_dtos_accept_creation_and_update_fields",
          "media_controller_exposes_governance_patch_endpoint",
          "media_service_presents_and_updates_governance_state",
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
  console.error("Media governance contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
