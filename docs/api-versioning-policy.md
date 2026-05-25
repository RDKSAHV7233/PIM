---
title: API Versioning & Deprecation Policy
audience: partners
status: active
last_updated: 2026-05-25
owner: Engineering
---

Use this document if you are building an integration and need to understand what backwards-compatibility guarantees Vexa PIM provides.

## 1. Current API Version

All endpoints are under `/api/v1`. There is currently one supported version.

## 2. Backwards Compatibility Guarantee

Within v1, Vexa PIM guarantees:

| Change type | Allowed without version bump |
|-------------|------------------------------|
| Adding a new endpoint | Yes |
| Adding optional fields to a request body | Yes |
| Adding fields to a response body | Yes |
| Adding new values to an enum in a response | Yes |
| Adding new query parameters (all optional) | Yes |
| Changing optional field to required | **No — breaking** |
| Removing a field from request or response | **No — breaking** |
| Changing the type of an existing field | **No — breaking** |
| Changing the HTTP method of an endpoint | **No — breaking** |
| Changing an endpoint's URL path | **No — breaking** |
| Changing error code strings | **No — breaking** |

Write your integration defensively: ignore unknown fields in responses, do not assume an enum is exhaustive, and do not fail on extra top-level keys.

## 3. Breaking Changes

Breaking changes require a new API version (`/api/v2`). The process:

1. The new version is released and announced at least **90 days** before the old version is deprecated.
2. The old version remains fully functional for the 90-day deprecation period.
3. A `Deprecation` header is added to all responses from the deprecated version, including the sunset date.
4. On the sunset date, the deprecated version returns HTTP 410 Gone for all requests.

There have been no breaking changes to v1 since its release.

## 4. Deprecation Notice Format

When a version enters the deprecation window, responses include:

```http
Deprecation: true
Sunset: Sat, 01 Nov 2026 00:00:00 GMT
Link: <https://docs.vexapim.com/api/v2>; rel="successor-version"
```

Subscribe to API change announcements via your account team to receive 90-day advance notice.

## 5. Beta Endpoints

Endpoints in active development may be labelled `[BETA]` in the OpenAPI spec. Beta endpoints:
- Are available under `/api/v1` but not covered by the backwards-compatibility guarantee
- May be changed or removed with 14 days notice
- Are identified by the `x-beta: true` extension in the OpenAPI spec

Do not build production integrations against beta endpoints without consulting your account team.

## 6. Endpoint Removal

An endpoint is never removed within a supported version — it is deprecated first. Deprecated-but-not-removed endpoints continue to function and are documented in the OpenAPI spec with a `deprecated: true` marker.

## 7. OpenAPI Spec Updates

The OpenAPI spec is regenerated on every release and committed to the repository:
- [`docs/openapi.json`](openapi.json)
- [`docs/openapi.yaml`](openapi.yaml)

Subscribe to these files in version control if you want automatic notifications of API surface changes.
