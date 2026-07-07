# ADR 0003 — Design-for-Both Infra Behind Repository/Adapter Ports

- **Status:** Accepted (locked decision — do not relitigate)
- **Date:** recorded 2026-07-07 (decision predates this record)

## Context
Production runs on Railway + MongoDB Atlas (Vector Search) + Redis + BullMQ. These are
convenient today but the project must be able to swap providers (Qdrant, Neo4j, Redis-Cloud)
without a core rewrite if pricing, limits, or capabilities force a move.

## Decision
All infrastructure sits behind strict **Repository/Adapter ports**. Core domain logic is
pure and provider-agnostic; the concrete Atlas/Redis/BullMQ implementations are swappable
adapters. Vector search, queues, and caching each go through a port.

## Consequences
- A provider swap (e.g. Atlas Vector → Qdrant) targets one adapter, not the domain.
- Adapters are the only place native/SDK specifics live; they get contract tests to catch
  upstream API drift.
- Deliberate coupling (e.g. in-process workers, ADR 0006) is documented as a scoped choice,
  not leaked into the domain.
