'use strict';

// The Garmin-only special-category (GDPR Art.9) canonical metrics — spo2 / respiratory_rate /
// body_battery in adapter.js's normalizers. ONE source of truth for BOTH ingest lanes:
//   - garminIngest.js (Garmin server-to-server) DROPS them until the user re-consents at
//     GARMIN_CONSENT_MIN_VERSION (the lawful basis to process them), and
//   - healthStore.ingestBatch (HealthKit / Health Connect batch) applies the SAME gate as a
//     defense-in-depth backstop, even though its normalizer no longer emits them at all.
// These are DISCLOSED to the user but only lawful to process once re-consented; the HC-lane
// metrics (heartRate / restingHeartRate / hrv / sleep*, lawful at v1) are NOT in this set and
// always pass through. (guard tests: garminConsentVersionGate + healthStoreConsentVersionGate)
const GARMIN_SPECIAL_CATEGORY_METRICS = new Set(['spO2', 'respirationRate', 'bodyBattery']);

module.exports = { GARMIN_SPECIAL_CATEGORY_METRICS };
