// The Design Lab sentinel (MB-084). A string no other module contains: the lab uses it at runtime,
// so it survives Metro and Hermes into the lab bundle, and the exclusion checks
// (scripts/lab/assertLabExcluded.mjs) search every release bundle and upload artifact for it.
// Found there, the lab leaked into a build that could be uploaded. Spelled here and nowhere else;
// everything that needs it imports it.
export const LAB_SENTINEL = 'kokonada-design-lab-sentinel-7c1e94b2';
