---
description: Implement one runtime agent from RUNTIME_AGENT_ARCHITECTURE.md.
argument-hint: [agent id or name]
---
Implement the runtime agent: $ARGUMENTS — per docs/RUNTIME_AGENT_ARCHITECTURE.md. ultrathink.
Build it in backend/app/agents/runtime/ behind its Port (interface) with an Adapter for any I/O; validate every emitted event against its schema; wrap external calls in the resilience fabric (circuit breaker + backoff + timeout); honor the zero-knowledge boundary. Start P0 scope only; strict TDD (RED→GREEN); stateful fakes with real semantics for any integration, never a green mock. resilience-auditor gate. One PR; present for approval.
