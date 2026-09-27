# ADR-0011: Connector Runtime Context

**Status**: Accepted
**Date**: 2026-09-27
**Author**: ADR sprint 2 — architecture sprint
**Gate**: Gate 1 — ADR-007
**Depends on**: ADR-0005 (Provider Adapter boundary), ADR-0006 (Connector Identity)

---

## Context

Every method on `ConnectorInterface` receives a `ConnectorContext` as its first parameter. This context carries the per-request tenant identity, installation reference, and access-token resolution needed for the adapter to communicate with its provider API. The interface is defined at `connector.interface.ts:27-54`:

```typescript
export interface ConnectorContext {
  tenantId: string;
  installationId: string;
  connectorId: string;
  sellerId?: string;
  marketplaceId?: string;
  marketCode?: string;
  currencyCode?: string;
  getAccessToken(): Promise<string>;
  fetch?(url: string, init?: ConnectorFetchInit): Promise<Response>;
}
```

This context model works. All 15 connectors use it. But three structural issues have emerged as the connector count grows:

### 1. Two divergent context factories

`ConnectorFrameworkService.buildContext()` (`connector-framework.service.ts:525-577`) is the primary runtime path. It populates `marketCode`/`currencyCode` from the Amazon marketplace registry or installation metadata, wires `getAccessToken` through `ConnectorCredentialService.getOrRefreshAccessToken()`, and wires `fetch` through `ConnectorHttpClient`.

`ConnectorInstallerService.buildConnectorContext()` (`connector-installer.service.ts:3702-3740`) is a separate implementation used during install/reconnect flows. It does NOT populate `marketCode` or `currencyCode`. Both implementations duplicate the `getAccessToken` + `fetch` wiring pattern.

The two factories can produce different contexts for the same installation, which means a connector method called during installation may behave differently than the same method called during publish.

### 2. Context bypass in credential verification

`verifyCandidateCredentials()` (`connector-installer.service.ts:442`) receives raw credentials as `Record<string, string>` outside the context pattern entirely. Each connector's `validateCredentials(ctx)` uses `ctx.getAccessToken()`, but the install-time credential verification bypasses this indirection. This is a pragmatic compromise — credentials aren't stored yet at verification time — but it means the "verify then store" path exercises different code than the "use stored credentials" path.

### 3. Logger is absent from context

Connectors receive a NestJS-injected logger at construction time (singletons). All log entries carry whatever metadata the connector class chooses to include. There is no structured correlation between a log entry and the `ConnectorContext` that produced it — no `installationId`, no `tenantId`, no request trace ID in the log context unless the connector manually adds it.

### 4. `fetch` is optional but always provided

The `fetch?` field is optional on the interface but every `buildContext()` call provides it. Making it optional forces every connector to null-check or cast. No connector handles the case where `fetch` is undefined — they all assume it exists.

---

## Decision

### 1. ConnectorContext remains the per-call context contract

`ConnectorContext` is the right abstraction. It is a plain object (not a class), assembled fresh for each connector method call, and carries exactly the per-request state that a stateless singleton adapter needs. This ADR does not propose replacing it.

### 2. Single context factory

A single `buildConnectorContext()` function must be the sole way to construct a `ConnectorContext`. Both `ConnectorFrameworkService.buildContext()` and `ConnectorInstallerService.buildConnectorContext()` must delegate to or be replaced by this single factory.

The factory accepts a `ConnectorInstallationRecord` (or equivalent) and produces a complete `ConnectorContext`. Fields like `marketCode` and `currencyCode` are populated consistently regardless of call site.

**Owner surface:** `connector-framework.service.ts` owns the canonical factory. `connector-installer.service.ts` calls it rather than maintaining a parallel implementation.

### 3. `fetch` becomes required

The `fetch` field on `ConnectorContext` is promoted from `fetch?` to `fetch`. Every context factory call provides it. Connectors no longer need to null-check.

### 4. ConnectorContext gains a correlation ID

A new `correlationId: string` field is added to `ConnectorContext`. The context factory generates it (UUID v4). All structured log entries, Error Authority captures, and `ConnectorSubmission` records include this correlation ID. This enables end-to-end tracing of a single connector method invocation across logs, errors, and persistence.

### 5. Credential verification context

`verifyCandidateCredentials()` receives a `ConnectorContext` built from the candidate credentials (not yet persisted). The context factory accepts an optional `candidateCredentials` parameter that overrides the stored-credential lookup. This brings credential verification onto the same code path as runtime calls, reducing the surface area where install-time and runtime behavior can diverge.

---

## Machine-Checkable Invariants

| ID | Description | Severity | Check |
|----|-------------|----------|-------|
| `context-factory-singleton` | Only one function constructs `ConnectorContext` objects | WARNING | Grep for `ConnectorContext` object literals outside the canonical factory |
| `context-fetch-required` | `fetch` is non-optional on `ConnectorContext` | ERROR | Type check: `fetch` field has no `?` modifier |
| `context-correlation-present` | Every `ConnectorContext` has a `correlationId` | WARNING | Factory always sets `correlationId` |

---

## Consequences

### Positive

- **Consistent context:** Install-time and runtime connector calls exercise the same context construction, reducing behavior divergence.
- **Traceability:** `correlationId` enables correlating logs, errors, submissions, and webhook events to a single connector invocation without manual metadata threading.
- **Simpler connector code:** `fetch` is always present; no null checks needed.

### Negative

- **Migration effort:** The `buildConnectorContext()` in `connector-installer.service.ts` must be refactored to call the canonical factory. This touches an active code path.
- **Credential verification change:** Building a context from candidate credentials introduces a new factory code path that must handle the "not yet persisted" case cleanly.

### Neutral

- Logger remains DI-injected, not context-carried. Connectors are singletons and their logger instance is stable for the process lifetime. The `correlationId` provides the missing per-call correlation without changing the logging infrastructure.

---

## Migration Constraint

Existing runtime-context factories remain supported until behavioral parity for install, reconnect, publish, and status paths is demonstrated.
