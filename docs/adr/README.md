# Architecture Decision Records (ADRs)

Lightweight records of non-trivial architectural decisions — **context → decision →
consequences** — so the locked decisions and future ones are traceable and
`KOKONADA_ARCHITECTURE_MASTER.md` can stay lean (per `docs/ORCHESTRATOR_FABLE.md`
`<engineering_excellence>`).

## How to add one
1. Copy the shape of an existing ADR. Number sequentially (`NNNN-kebab-title.md`).
2. Status: `Proposed` → `Accepted` → (`Superseded by NNNN` / `Deprecated`).
3. Keep it short. One decision per file. Link the PR that implements it.

## Index
| # | Decision | Status |
| :-- | :--- | :--- |
| [0001](0001-100-percent-free-app.md) | 100% free app — no paywalls, no paid tiers | Accepted (locked) |
| [0002](0002-full-react-native-migration-web-sunset.md) | Full React Native migration; web sunset | Accepted (locked) |
| [0003](0003-design-for-both-infra-ports.md) | Design-for-both infra behind Repository/Adapter ports | Accepted (locked) |
| [0004](0004-never-pure-llm-audio-features.md) | Never pure-LLM audio features | Accepted (locked) |
| [0005](0005-zero-knowledge-biometrics.md) | Zero-knowledge biometrics (field-level AES-256-GCM) | Accepted (locked) |
| [0006](0006-in-process-workers.md) | In-process BullMQ workers on Railway free plan | Accepted |
| [0007](0007-mobile-ci-node-24-interim.md) | Mobile CI pinned to Node 24 (interim) | Accepted (interim — see [#84](https://github.com/DanielMalede/Kokonada/issues/84)) |
