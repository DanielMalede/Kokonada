# ADR 0008 — Global Feature Caches Are Excluded From GDPR Erasure

- **Status:** Accepted
- **Date:** 2026-07-07 (Squad 6 defect triage, Row 21 / issue #91)

## Context
On-device QA flagged that after an account is deleted, the `audiofeatures` and
`trackembeddings` Mongo collections still contain rows — raised as a possible GDPR erasure
leak (special-category data must be fully erased). This required a definitive triage.

Evidence (read-only inspection):
- `AudioFeature` (`backend/app/models/AudioFeature.js`) and `TrackEmbedding`
  (`backend/app/models/TrackEmbedding.js`) have **no `userId`** and no user-identifying field
  (`userId` grep = 0). Both are keyed only by `recordingKey` — the `spotify:<trackId>` /
  `youtube:<videoId>` URI of a **public-catalog recording** — and store only acoustic
  properties (BPM/energy/valence…) and a deterministic embedding vector.
- The **personal** association — *which* recordings a given user has — lives exclusively in
  `MusicProfile.library`, which **is** deleted by the cascade
  (`backend/app/services/privacy/erasure.js`), alongside every other per-user model
  (BiometricLog, MedicalProfile, PlaylistSession, ServeEvent, Identity, RefreshToken, and the
  PR-#78 `UnclassifiedTrack`) plus a Redis key purge.
- `recordingKey` is **shared across all users**.

## Decision
`audiofeatures` and `trackembeddings` are **deliberately excluded** from the erasure cascade.
They are global, URI-keyed, cross-user caches of public-catalog acoustic data — **no `userId`,
no PII** — so they carry nothing that can re-associate a row with a deleted user. After the
cascade removes `MusicProfile.library`, no personal linkage remains.

A one-line "deliberately not erased" comment is added at `erasure.js` to prevent a future
well-meaning change from adding them.

## Consequences
- **Not a compliance leak.** Erasure remains complete for all personal/PII data.
- Adding these caches to the cascade would be a **bug**: a `deleteMany` for one departing user
  would evict rows shared by every other user and force expensive ReccoBeats/LLM re-fetches.
- If either model ever gains a `userId` or any user-specific tuning, this ADR must be revisited
  and that model added to the cascade.
