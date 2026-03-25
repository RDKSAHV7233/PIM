# TEJ PIM Connector Recipes

Status: Active workflow examples  
Date: 2026-03-23  
Audience: Connector engineers and reviewers

## 1. Purpose

Use this file for concrete workflow examples on top of the current TEJ PIM connector model.

This file is recipe-oriented.
For API/context overview, use:
- `docs/connectors/TEJ_PIM_CONNECTOR_DEVELOPER_GUIDE.md`

For repo implementation details, use:
- `docs/connectors/TEJ_PIM_CONNECTOR_INTERNAL_IMPLEMENTATION_GUIDE.md`

Current connector reality:
- `flipkart` is the live publish-capable reference path
- `amazon-in` is still a stub
- `meesho` is still export-only in design, but export generation is not yet complete
- broad rollout evidence is still incomplete under `INC-08`

## 2. Recipe: Export-Only Connector

Use this when a channel produces a downloadable/exportable artifact instead of direct publish completion.

Typical flow:
1. prepare mapping in `/channels/mappings`
2. validate the mapping
3. evaluate publish-readiness
4. create export job
5. process export job
6. surface export artifact/result in UI

Important rules:
- label user action as `Export`, not `Publish`
- keep failure reason visible
- do not imply direct channel-side publish confirmation

Relevant endpoints:
- `POST /api/v1/marketplace/connectors/{connectorSlug}/mappings/preflight`
- `POST /api/v1/marketplace/connectors/{connectorSlug}/publish-readiness`
- `POST /api/v1/marketplace/products/{id}/export-jobs`
- `POST /api/v1/marketplace/export-jobs/{id}/process`

## 3. Recipe: Publish-Capable Connector

Use this when a connector supports a direct publish/submission attempt.

Typical flow:
1. prepare mapping
2. validate mapping
3. run publish-readiness
4. create job / submission attempt
5. process queued work
6. surface completed or failed result with reason

Important rules:
- only show `Publish` if capability supports publish
- readiness blockers must be visible before the action
- failed publish must surface an actionable reason

## 4. Recipe: Create and Publish a Mapping Version

Typical sequence:
1. `POST .../mappings/versions`
2. `POST .../mappings/versions/{versionId}/validate`
3. `POST /api/v1/auth/step-up`
4. `POST .../mappings/versions/{versionId}/publish`

Notes:
- publish is high-risk and requires step-up re-authentication
- only one published mapping exists per `(tenant, connector, categoryScope)`

## 5. Recipe: Roll Back a Mapping

Typical sequence:
1. list versions
2. choose prior known-good version
3. `POST /api/v1/auth/step-up`
4. `POST .../mappings/versions/{versionId}/rollback`

Notes:
- rollback creates a new published clone
- history is preserved
- existing live mapping is superseded instead of mutated

## 6. Recipe: Category Alignment

Typical sequence:
1. search taxonomy
2. inspect unmapped categories
3. update category-scoped mapping
4. validate
5. publish if ready

Relevant endpoints:
- `GET .../taxonomy/search`
- `GET .../taxonomy/unmapped`
- `POST .../mappings/versions`
- `POST .../mappings/versions/{versionId}/validate`

## 7. Recipe: High-Risk Action with Step-Up Re-Authentication

Use for:
- publish mapping version
- rollback mapping version
- archive mapping version

Typical sequence:
1. call `POST /api/v1/auth/step-up`
2. receive step-up token
3. send `x-pim-step-up-token`
4. perform protected action

Do not call this MFA in product or developer docs.

## 8. Recipe: UI Truthfulness Checks

Before shipping a connector flow, confirm:
- export-only connectors show `Export`, not `Publish`
- legacy `/connectors/[installationId]/mapping` is not treated as a primary editor
- `/channels/mappings` is the only editable mapping surface
- failure reasons are visible
- readiness blockers are shown before the high-risk action
