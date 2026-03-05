# ADR-004: Search Strategy for MVP

Status: Accepted
Date: 2026-02-25

## Context
Early optimization with dedicated search infrastructure may delay MVP.

## Decision
Start with indexed PostgreSQL queries for product search/filter in MVP.

## Consequences
- Lower initial complexity.
- Dedicated search engine may be introduced post-MVP if query performance degrades.
