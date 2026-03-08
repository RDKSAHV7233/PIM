# Page User Guide

## Route
- /connectors/[installationId]/mapping

## Source File
- C:/Users/Om Computers/PIM1/apps/web/src/app/connectors/[installationId]/mapping

## Page Title (Validated)
- Transition-only connector mapping route.

## Purpose
- Transitional route that redirects users into the canonical lifecycle mapping workspace.
- Do not treat this page as a second editable mapping surface.

## Functionality (Validated from Page Imports/Actions)
- Data retrieval/API helpers used on this page:
  - getInstalledConnectors
  - getProduct

## User Actions
- Follow the redirect into `/channels/mappings`
- Review connector/product context passed into the canonical mapping workspace

## Notes
- This document is generated from current route source and only contains validated references.
- Editing happens in `/channels/mappings`, not here.
- For exact API endpoint mapping, refer to docs/openapi.yaml and apps/web/src/lib/api.ts.
