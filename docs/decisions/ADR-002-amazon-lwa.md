# ADR-002: Amazon LWA OAuth Integration

- Date: 2026-03-04
- Status: Accepted

## Problem
Connector installation requires secure OAuth token exchange and credential persistence for Amazon.

## Options Considered
1. Inline OAuth handling inside connector service.
2. Dedicated auth client + installer service orchestration.

## Decision
Use dedicated Amazon LWA client with connector-installer orchestration and encrypted credential storage.

## Consequences
- Clear separation of OAuth transport from installation lifecycle.
- Credential lifecycle events can be audited without exposing secret material.
