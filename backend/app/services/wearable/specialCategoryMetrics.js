'use strict';

// The Garmin-only special-category (GDPR Art.9) canonical metrics. ONE source of truth for BOTH
// ingest lanes:
//   - garminIngest.js (Garmin server-to-server) DROPS them until the user re-consents at
//     GARMIN_CONSENT_MIN_VERSION (the lawful basis to process them), and
//   - healthStore.ingestBatch (HealthKit / Health Connect batch) applies the SAME gate as a
//     defense-in-depth backstop, even though its normalizer no longer emits them at all.
// These are DISCLOSED to the user but only lawful to process once re-consented; the HC-lane
// metrics (heartRate / restingHeartRate / hrv / sleep*, lawful at v1) are NOT in this set and
// always pass through. (guard tests: garminConsentVersionGate + healthStoreConsentVersionGate)
//
// spO2 / respirationRate / bodyBattery are emitted by adapter.js's Garmin normalizers.
// dailyReadiness (Garmin Training Readiness, 0-100) has NO normalizer yet — but it is a PROFILE
// SCALAR: it is in medicalProfileService's PROFILE_SCALAR_METRICS, so ANY batch carrying that
// metric is written straight onto the field-level-encrypted MedicalProfile.dailyReadiness, then
// weighted into the recovery axis and served by pulseController. Being absent from this set meant
// it was admitted at ANY consent version, including none at all. It is listed here so that lane
// can never open below the consent floor.
const GARMIN_SPECIAL_CATEGORY_METRICS = new Set(['spO2', 'respirationRate', 'bodyBattery', 'dailyReadiness']);

module.exports = { GARMIN_SPECIAL_CATEGORY_METRICS };
