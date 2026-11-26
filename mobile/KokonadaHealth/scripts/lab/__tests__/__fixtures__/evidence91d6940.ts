// One real row of the 91d6940 evidence, and its manifest's top level, as the harness wrote them on 2026-11-18 (UI-276,
// architect ruling A5: re-reporting the 91d6940 manifests must still pass validation unchanged). Copied from
// Kokonada-private/evidence/v1/91d694034be7/session/v1-field/manifest.json (the row fallback-dark-rest.1, one of the
// fallback rows UI-272 re-reports), verbatim, with one value planted: the phone's build fingerprint, in both places.
// The top level keeps its own proofs and moving lists, and its rows and determinism lists hold only this row's entries
// (the reports hold each list entry to its own reader, never to the top level's schema). Test-only.

const FINGERPRINT = 'samsung/fixture/fixture:16/planted/1:user/release-keys';

export const ROW_91D6940 = {
  shot: 'fallback-dark-rest',
  repeat: 1,
  file: 'fallback-dark-rest.1.png',
  sha256: '312355f70ea470e2a9dbe6cf7e001390cf017b9d793421e75a431d9cb8e96e96',
  appRegionHash: 'fcaac3a9e863a6caf5e54ea1ffd5fa2538eddd2c32e8c0f3dd7c325d5a0698a4',
  commit: { sha: '91d694034be746a0d1dede69934ae1812beea074', porcelainEmpty: true },
  stamp: { bundleSha256: '97d918b10d03617d0c389d22a2e372fdd1eec0f2d2775ad4ff2e3732ac35dff7', tokens: {} },
  device: { model: 'SM-S906E', fingerprint: FINGERPRINT, width: 1080, height: 2340, density: 420, refreshRate: 120.00001 },
  app: { package: 'com.kokonadahealth.lab', apkSha256: 'bd3812e8df9824b547a0f7069ef9019bc4285651701df63f6252a69d0c67de9a', buildType: 'lab', hermes: true, dev: false },
  scene: 'fallback.abyss.dark.rest',
  direction: 'abyss',
  face: 'dark',
  fontScale: { requested: 1, observed: 1, app: 1 },
  motion: { reduceMotionObserved: false, powerSaveObserved: false, tier: null },
  locale: 'he-IL',
  isRTL: true,
  clock: { mode: 'fixed', t: 11000, seq: 0 },
  shaderStatus: 'fallback-scene',
  uimode: 'night',
  animatorScales: { window: 1, transition: 1, animator: 1 },
  forceDark: false,
  colorSpace: 'sRGB',
  region: { x: 0, y: 74, width: 1080, height: 2227 },
  probes: {
    inside: {},
    excluded: [{ id: 'stage', reason: 'partly under the system bars', px: { x: 0, y: 0, width: 1079.9999656677246, height: 2340.000045776367 } }],
  },
  timestamps: { launched: '2026-11-18T12:20:39.657Z', ready: '2026-11-18T12:20:40.823Z', captured: '2026-11-18T12:20:43.137Z' },
  expect: { direction: 'abyss', face: 'dark', hero: null, tier: null },
  renderScale: null,
  sampling: null,
  gl: { renderer: 'Qualcomm, Adreno (TM) 730', gles: 'OpenGL ES 3.2 V@0615.98 (GIT@0c393b63cf, I94e2bd5684, 1746191168) (Date:05/02/25)', reason: null },
  display: { colorMode: 'ColorMode::SRGB (7)', wideColor: true, refreshMode: 'peakRefreshRate 120.00001 Hz, vsyncRate 120.00001 Hz', reason: null },
  skiaVersion: '2.6.9',
  shaderReason: 'the lab fallback scene: FieldFallback mounted directly',
  stage: { x: 0, y: 0, width: 1079.9999656677246, height: 2340.000045776367 },
  pixelRatio: 2.625,
};

export const MANIFEST_91D6940 = {
  plan: 'v1-field',
  outcome: 'passed',
  failure: null,
  restoreFailures: [],
  commit: '91d694034be746a0d1dede69934ae1812beea074',
  stamp: {
    commit: '91d694034be746a0d1dede69934ae1812beea074', porcelainEmpty: true,
    bundleSha256: '97d918b10d03617d0c389d22a2e372fdd1eec0f2d2775ad4ff2e3732ac35dff7', tokens: {}, entry: 'index.lab.js', dev: false,
    createdAt: '2026-11-17T18:38:34.942Z',
  },
  apkSha256: 'bd3812e8df9824b547a0f7069ef9019bc4285651701df63f6252a69d0c67de9a',
  device: { model: 'SM-S906E', fingerprint: FINGERPRINT, width: 1080, height: 2340, density: 420, refreshRate: 120.00001, forceDark: false, locale: 'he-IL' },
  render: { gl: ROW_91D6940.gl, display: ROW_91D6940.display },
  skiaVersion: '2.6.9',
  startedAt: '2026-11-18T12:16:05.404Z',
  finishedAt: '2026-11-18T12:25:01.561Z',
  rows: [ROW_91D6940],
  determinism: [{ shot: 'fallback-dark-rest', equal: true, hashes: [ROW_91D6940.appRegionHash, ROW_91D6940.appRegionHash] }],
  proofs: [
    { shot: 'dark-three-full-moving-control', kind: 'draws-frames', seconds: 10, frames: 1026, passed: true },
    { shot: 'dark-three-still-reduced-motion', kind: 'zero-frames', seconds: 10, frames: 0, passed: true },
  ],
  checks: [],
  results: [],
  records: [],
  moving: [{ shot: 'dark-three-full-moving-control', repeat: 1, reason: 'a real-time clock with motion on at the full tier: not settle-checked' }],
  settleFailures: [],
};
