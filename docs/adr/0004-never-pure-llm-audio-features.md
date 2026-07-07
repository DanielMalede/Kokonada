# ADR 0004 — Never Pure-LLM Audio Features

- **Status:** Accepted (locked decision — do not relitigate)
- **Date:** recorded 2026-07-07 (decision predates this record)

## Context
Track audio features (energy, tempo, valence, etc.) drive selection and biosonic
translation. Asking an LLM to invent feature values is cheap but unreliable — it
hallucinates plausible-but-wrong numbers, and Spotify's `/audio-features` +
`/recommendations` endpoints are dead for new apps, so the profile is rebuilt from listening
history. Feature quality directly determines playlist quality.

## Decision
Audio features are **measured/derived first** (real API where available + Mongo/Redis
feature cache). An LLM (Groq) is only a **confidence-capped fallback** when no measured value
exists, never the primary source, and its outputs are bounded/validated before use.

## Consequences
- The feature store and hydration pipeline are the source of truth; the LLM fills gaps.
- LLM-fallback rate is a tracked metric; a high rate signals a hydration gap to fix, not a
  reason to trust the LLM more.
- Groq stays within the free 6000-TPM ceiling via `withRetry` 429-backoff.
