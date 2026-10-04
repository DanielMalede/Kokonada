// The stamp chain (OPS-100; V1 plan section 5). bundleLab writes lab-stamp.json beside the lab
// bundle; Gradle packs both into the APK; the harness refuses to capture unless every link holds:
//   git HEAD + empty porcelain  ->  the stamp  ->  the bundle and the stamp inside the APK
//   ->  the APK installed on the phone  ->  READY's sentinel (checked by lib/protocol.mjs).

const HEX64 = /^[0-9a-f]{64}$/;
const SHA1 = /^[0-9a-f]{40}$/;

/** A refusal: the scripts stop before building, capturing or touching the phone. */
export class Refused extends Error {}

/** The stamp for a lab bundle. Refused from a tree with uncommitted changes. */
export function makeStamp({ commit, porcelain, bundleSha256, tokens = {}, entry, createdAt }) {
  if (String(porcelain).trim() !== '') {
    throw new Error(`the tree has uncommitted changes; a lab stamp is only made from a clean commit:\n${porcelain}`);
  }
  if (!SHA1.test(commit) || !HEX64.test(bundleSha256)) throw new Error('a lab stamp needs a full commit sha and the bundle sha256');
  // dev: false is how bundleLab always bundles (release-equivalent JS); the manifest's app.dev reads it.
  return { commit, porcelainEmpty: true, bundleSha256, tokens, entry, dev: false, createdAt };
}

const canonical = (v) => (Array.isArray(v)
  ? `[${v.map(canonical).join(',')}]`
  : v !== null && typeof v === 'object'
    ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`
    : JSON.stringify(v));

/**
 * Every broken link, as a sentence. [] when the chain holds.
 * @param {{ head: string, porcelain: string, stamp: object, apk?: { bundleSha256: string, stamp: object|null },
 *           builtApkSha256?: string, installedApkSha256?: string }} chain
 */
export function verifyStampChain({ head, porcelain, stamp, apk, builtApkSha256, installedApkSha256 }) {
  const problems = [];
  const complete = stamp && SHA1.test(stamp.commit ?? '') && stamp.porcelainEmpty === true && HEX64.test(stamp.bundleSha256 ?? '');
  if (!complete) problems.push('the lab stamp is missing or incomplete: run node scripts/lab/bundleLab.mjs');
  if (String(porcelain ?? '').trim() !== '') problems.push(`the tree has uncommitted changes since the lab was bundled:\n${porcelain}`);
  if (stamp && head !== stamp.commit) problems.push(`the lab was built from ${stamp.commit} but HEAD is ${head}: bundle and build again`);
  if (apk) {
    if (stamp && apk.bundleSha256 !== stamp.bundleSha256) problems.push('the APK carries another bundle than the stamp names: build the APK again');
    if (!apk.stamp) problems.push('the APK carries no lab-stamp.json');
    else if (stamp && canonical(apk.stamp) !== canonical(stamp)) problems.push('the APK carries another lab-stamp.json than the tree');
  }
  if (installedApkSha256 !== undefined && installedApkSha256 !== builtApkSha256) {
    problems.push('the installed lab is not this APK: install it (adb install -r) and capture again');
  }
  return problems;
}
