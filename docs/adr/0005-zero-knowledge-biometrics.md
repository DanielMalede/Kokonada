# ADR 0005 — Zero-Knowledge Biometrics

- **Status:** Accepted (locked decision — do not relitigate)
- **Date:** recorded 2026-07-07 (decision predates this record; implements audit finding F3)

## Context
Heart rate, HRV, sleep, and derived readiness are **special-category health data under GDPR
Art. 9**. The 2026-06-22 security audit flagged (F3) that these were stored plaintext at the
field level. Leaking vitals to clients or external AI providers would be a serious breach.

## Decision
Raw HR/HRV/sleep are **AES-256-GCM field-encrypted at rest** (`models/encryptedField.js`),
decrypted **only in worker scope**. The serve ledger stores **coarse bands**, never raw
vitals. Biometrics are **never logged** and **never shipped to clients or external AI**
(the Groq cache stores only `md5(prompt)` + derived params, per F16).

## Consequences
- Any code path that decrypts a biometric field must be auditable (audit-trail requirement).
- Key rotation is supported (`ENCRYPTION_KEY_PREVIOUS`) with optional AAD context binding.
- A permanent GDPR erasure-completeness guard + the `UnclassifiedTrack` erasure cascade keep
  deletion total. New biometric surfaces inherit these rules by default.
