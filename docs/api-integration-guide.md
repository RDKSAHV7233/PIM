---
title: API & Webhook Integration Guide
audience: partners
status: active
last_updated: 2026-05-25
owner: Engineering
---

Use this guide if you are building an integration against the Vexa PIM REST API or want to receive real-time events via webhooks.

## 1. Overview

The Vexa PIM API is a JSON REST API versioned at `/api/v1`. It covers 191 endpoints across catalog, channels, bulk import, auth, billing, audit, and administration.

Full machine-readable spec: [`docs/openapi.json`](openapi.json) and [`docs/openapi.yaml`](openapi.yaml)

Interactive Swagger UI: `https://<your-workspace>/api` (available in non-production environments)

## 2. Authentication

### 2.1 API Keys (recommended for server-to-server)

Generate an API key in your workspace:

1. Go to **Settings → API Keys**.
2. Click **Create Key**.
3. Give it a descriptive name.
4. Copy the key immediately — it is shown only once.

Include the key in every request using the `x-api-key` header:

```http
GET /api/v1/catalog/products HTTP/1.1
Host: app.vexapim.com
x-api-key: pk_live_xxxxxxxxxxxxxx
Accept: application/json
```

API keys are tenant-scoped. A key issued in workspace `alpha` cannot access workspace `beta`.

### 2.2 JWT Bearer Tokens (for user-facing integrations)

Obtain a token by logging in:

```http
POST /api/v1/auth/login
Content-Type: application/json

{
  "workspaceSlug": "your-workspace",
  "userId": "user@example.com",
  "password": "yourpassword",
  "expiresInMinutes": 60
}
```

Response:
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresAt": "2026-05-25T15:00:00.000Z"
}
```

Use the token in subsequent requests:

```http
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

Refresh before expiry:

```http
POST /api/v1/auth/refresh
Authorization: Bearer <current-token>
```

## 3. Your First API Call

Check that you can reach the API and your key is valid:

```http
GET /api/v1/health
x-api-key: pk_live_xxxxxxxxxxxxxx
```

Expected response (200):
```json
{ "status": "ok" }
```

List your first page of products:

```http
GET /api/v1/catalog/products?limit=20&offset=0
x-api-key: pk_live_xxxxxxxxxxxxxx
```

## 4. Pagination

All list endpoints use offset-based pagination with `limit` and `offset` query parameters.

Default limit: 20. Maximum limit: 100.

```http
GET /api/v1/catalog/products?limit=50&offset=0
GET /api/v1/catalog/products?limit=50&offset=50
```

Response includes a `total` field indicating the full count:

```json
{
  "items": [...],
  "total": 450,
  "limit": 50,
  "offset": 0
}
```

## 5. Key Endpoints by Resource

### 5.1 Catalog

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/catalog/products` | List products with filters |
| `POST` | `/api/v1/catalog/products` | Create a product |
| `GET` | `/api/v1/catalog/products/{id}` | Get a single product |
| `PATCH` | `/api/v1/catalog/products/{id}` | Update product fields |
| `DELETE` | `/api/v1/catalog/products/{id}` | Delete a product |

Filter by status: `?status=draft`, `?status=approved`, `?status=published`

### 5.2 Bulk Import

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/bulk-import/jobs` | Start a new import job (multipart/form-data, field: `file`) |
| `GET` | `/api/v1/bulk-import/jobs` | List import jobs |
| `GET` | `/api/v1/bulk-import/jobs/{id}` | Get import job status and error report |

### 5.3 Submissions (Channel Publishing)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/v1/submissions` | Submit products to a channel |
| `GET` | `/api/v1/submissions` | List submission records |
| `GET` | `/api/v1/submissions/{id}` | Get submission status |

### 5.4 Connectors

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/connectors` | List installed connectors |
| `POST` | `/api/v1/connectors/{type}/install` | Install a connector with credentials |
| `PATCH` | `/api/v1/connectors/{id}` | Update connector credentials |
| `DELETE` | `/api/v1/connectors/{id}` | Remove a connector |

### 5.5 Admin & API Keys

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/v1/admin/api-keys` | List API keys |
| `POST` | `/api/v1/admin/api-keys` | Create an API key |
| `POST` | `/api/v1/admin/api-keys/{id}/revoke` | Revoke an API key |

## 6. Webhooks

Vexa PIM can push events to your HTTP endpoint when things happen in your workspace.

### 6.1 Register a Webhook

```http
POST /api/v1/connector-webhooks
Authorization: Bearer <token>
Content-Type: application/json

{
  "url": "https://your-server.example.com/vexa-events",
  "secret": "your-signing-secret",
  "events": ["submission.completed", "submission.failed", "import.completed"]
}
```

### 6.2 Verify Webhook Signatures

Every webhook request includes an `x-vexa-signature` header. Verify it before processing:

```javascript
const crypto = require("crypto");

function verifySignature(body, signature, secret) {
  const expected = crypto
    .createHmac("sha256", secret)
    .update(body)
    .digest("hex");
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(`sha256=${expected}`)
  );
}
```

Reject requests where verification fails.

### 6.3 Event Payloads

All events share the same envelope:

```json
{
  "event": "submission.completed",
  "workspaceSlug": "your-workspace",
  "occurredAt": "2026-05-25T14:00:00.000Z",
  "data": { ... }
}
```

**`submission.completed`**
```json
{
  "submissionId": "sub_abc123",
  "channelType": "amazon_india",
  "productIds": ["prod_001", "prod_002"],
  "status": "completed"
}
```

**`submission.failed`**
```json
{
  "submissionId": "sub_abc123",
  "channelType": "flipkart",
  "productIds": ["prod_003"],
  "errorCode": "CREDENTIAL_INVALID",
  "message": "Flipkart API key rejected"
}
```

**`import.completed`**
```json
{
  "jobId": "job_xyz789",
  "rowsProcessed": 500,
  "rowsCreated": 480,
  "rowsRejected": 20,
  "errorReportUrl": "/api/v1/bulk-import/jobs/job_xyz789/errors"
}
```

### 6.4 Retry Policy

Webhook deliveries are retried up to 5 times with exponential back-off (5 s, 15 s, 60 s, 300 s, 900 s) on non-2xx responses or network errors. After 5 failures the delivery is marked dead-lettered and visible in the Submissions dashboard.

Acknowledge with any 2xx response. Return within 10 seconds — use a queue if your processing takes longer.

## 7. Rate Limits

| Scope | Limit |
|-------|-------|
| API key requests | 300 requests / minute per key |
| Login endpoint | 10 attempts / 15 min per user |
| Bulk import | 1 active concurrent job per workspace |
| Webhook deliveries | 50 concurrent outbound per workspace |

When rate limited you receive HTTP 429 with `Retry-After` in seconds.

## 8. Error Format

All errors use a consistent structure:

```json
{
  "error": "MACHINE_READABLE_CODE",
  "statusCode": 400,
  "message": "Human-readable description"
}
```

Common error codes:

| Code | HTTP | Meaning |
|------|------|---------|
| `INVALID_CREDENTIALS` | 401 | Wrong email or password |
| `TOKEN_EXPIRED` | 401 | JWT has expired — refresh it |
| `FORBIDDEN` | 403 | Your role does not allow this action |
| `TENANT_SUSPENDED` | 403 | Workspace is suspended — contact billing |
| `NOT_FOUND` | 404 | Resource does not exist |
| `PLAN_LIMIT_REACHED` | 402 | You have hit your plan's limit |
| `WORKSPACE_SLUG_ALREADY_ASSIGNED` | 409 | Workspace name is taken |
| `RATE_LIMITED` | 429 | Too many requests |

## 9. SDK and Tools

No official SDK yet. Use any HTTP client. Examples:

**Node.js (fetch)**
```javascript
const res = await fetch("https://app.vexapim.com/api/v1/catalog/products", {
  headers: { "x-api-key": process.env.VEXA_API_KEY }
});
const { items, total } = await res.json();
```

**Python (requests)**
```python
import requests
resp = requests.get(
    "https://app.vexapim.com/api/v1/catalog/products",
    headers={"x-api-key": os.environ["VEXA_API_KEY"]}
)
data = resp.json()
```

**cURL**
```bash
curl -s https://app.vexapim.com/api/v1/catalog/products \
  -H "x-api-key: pk_live_xxxxxxxxxxxxxx"
```
