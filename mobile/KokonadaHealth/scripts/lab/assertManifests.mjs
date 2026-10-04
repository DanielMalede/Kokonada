// The merged-manifest check of the Design Lab exclusion (MB-084).
//
//   node scripts/lab/assertManifests.mjs [--build-dir android/app/build]
//
// Run it after Gradle has merged the manifests, at least:
//   ./gradlew :app:processReleaseMainManifest :app:processLabMainManifest
// It reads every merged manifest AGP wrote (merged_manifest, merged_manifests, bundle_manifest,
// packaged_manifests), per variant, and checks:
//   · every variant that can be uploaded (release, and any other variant that is not the lab):
//     no Design Lab component, and not the lab package;
//   · the lab variant: the lab package; exactly one launcher, the lab activity; none of the real
//     app's activities (MainActivity, the Health Connect rationale and its alias); no INTERNET, no
//     health and no Bluetooth or location permission; none of the real app's URL schemes
//     (kokonada:// is its OAuth return, kokonadahealth:// its Spotify redirect); no cleartext.
//
// Exit codes: 0 clean · 1 a check failed · 2 nothing to check (release or lab not merged). 2 is
// never a pass.

import fs from 'node:fs';
import path from 'node:path';

// ---- a small, strict XML reader: enough for a merged manifest, and it throws on anything else ----

const ENTITIES = { quot: '"', apos: "'", lt: '<', gt: '>', amp: '&' };
const decode = (s) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, e) => {
  if (e[0] === '#') return String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
  return ENTITIES[e] ?? whole;
});

/** The element tree of an XML document: { name, attrs, children }; the document node holds the root. */
export function parseXml(text) {
  const fail = (at, why) => { throw new Error(`not well-formed xml at ${at}: ${why}`); };
  const doc = { name: '#document', attrs: {}, children: [] };
  const stack = [doc];
  const NAME = /[A-Za-z_][\w:.-]*/y;
  const ATTRIBUTE_OR_END = /\s*(?:([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')|(\/?)>)/y;
  let i = 0;
  while (i < text.length) {
    const lt = text.indexOf('<', i);
    if (lt < 0) break;
    i = lt;
    const skipTo = (close, what) => {
      const end = text.indexOf(close, i);
      if (end < 0) fail(i, `unterminated ${what}`);
      i = end + close.length;
    };
    if (text.startsWith('<?', i)) { skipTo('?>', 'declaration'); continue; }
    if (text.startsWith('<!--', i)) { skipTo('-->', 'comment'); continue; }
    if (text.startsWith('<![CDATA[', i)) { skipTo(']]>', 'CDATA section'); continue; }
    if (text.startsWith('<!', i)) { skipTo('>', 'declaration'); continue; }
    if (text.startsWith('</', i)) {
      const end = text.indexOf('>', i);
      if (end < 0) fail(i, 'unterminated end tag');
      const name = text.slice(i + 2, end).trim();
      const open = stack.pop();
      if (stack.length === 0 || open.name !== name) fail(i, `</${name}> does not close <${open.name}>`);
      i = end + 1;
      continue;
    }
    NAME.lastIndex = i + 1;
    const name = NAME.exec(text);
    if (!name) fail(i, 'bad tag name');
    const el = { name: name[0], attrs: {}, children: [] };
    let j = NAME.lastIndex;
    for (;;) {
      ATTRIBUTE_OR_END.lastIndex = j;
      const m = ATTRIBUTE_OR_END.exec(text);
      if (!m) fail(j, `bad attribute in <${el.name}>`);
      j = ATTRIBUTE_OR_END.lastIndex;
      if (m[1] !== undefined) { el.attrs[m[1]] = decode(m[2] ?? m[3]); continue; }
      stack[stack.length - 1].children.push(el);
      if (m[4] !== '/') stack.push(el);
      break;
    }
    i = j;
  }
  if (stack.length !== 1) fail(text.length, `<${stack[stack.length - 1].name}> is never closed`);
  return doc;
}

const descendants = (el) => el.children.flatMap((c) => [c, ...descendants(c)]);
const COMPONENTS = new Set(['activity', 'activity-alias', 'service', 'receiver', 'provider']);
const isLauncherFilter = (filter) =>
  filter.children.some((c) => c.name === 'action' && c.attrs['android:name'] === 'android.intent.action.MAIN')
  && filter.children.some((c) => c.name === 'category' && c.attrs['android:name'] === 'android.intent.category.LAUNCHER');

/** What a merged manifest declares, as the checks need it. */
export function manifestFacts(xml) {
  const manifest = parseXml(xml).children.find((c) => c.name === 'manifest');
  if (!manifest) throw new Error('not an Android manifest: no <manifest> root');
  const app = manifest.children.find((c) => c.name === 'application');
  const components = (app ? app.children : [])
    .filter((c) => COMPONENTS.has(c.name))
    .map((c) => ({ kind: c.name, name: c.attrs['android:name'], target: c.attrs['android:targetActivity'] ?? null, el: c }));
  return {
    package: manifest.attrs.package ?? null,
    components: components.map(({ kind, name, target }) => ({ kind, name, target })),
    launchers: components
      .filter((c) => (c.kind === 'activity' || c.kind === 'activity-alias'))
      .filter((c) => c.el.children.some((f) => f.name === 'intent-filter' && isLauncherFilter(f)))
      .map((c) => c.name),
    permissions: manifest.children
      .filter((c) => c.name === 'uses-permission' || c.name === 'uses-permission-sdk-23')
      .map((c) => c.attrs['android:name']),
    schemes: descendants(manifest).filter((c) => c.name === 'data' && c.attrs['android:scheme']).map((c) => c.attrs['android:scheme']),
    cleartext: app ? app.attrs['android:usesCleartextTraffic'] ?? null : null,
    browsable: descendants(manifest).some((c) => c.name === 'category' && c.attrs['android:name'] === 'android.intent.category.BROWSABLE'),
  };
}

// ---- the checks ---------------------------------------------------------------------------

const LAB_PACKAGE_SUFFIX = '.lab';
const LAB_ACTIVITY = 'com.kokonadahealth.lab.DesignLabActivity';
const REAL_APP_COMPONENTS = [
  'com.kokonadahealth.MainActivity',
  'com.kokonadahealth.PermissionsRationaleActivity',
  'com.kokonadahealth.ViewPermissionUsageActivity',
];
const REAL_APP_SCHEMES = new Set(['kokonada', 'kokonadahealth']);
const RADIO_AND_LOCATION = new Set([
  'BLUETOOTH', 'BLUETOOTH_ADMIN', 'BLUETOOTH_SCAN', 'BLUETOOTH_CONNECT', 'BLUETOOTH_ADVERTISE',
  'ACCESS_FINE_LOCATION', 'ACCESS_COARSE_LOCATION', 'ACCESS_BACKGROUND_LOCATION',
].map((p) => `android.permission.${p}`));

// The only permissions the lab may hold (the round-1 review's MF-5): what React Native and its
// libraries bring that touches no user data, plus the lab's own receiver permission.
const LAB_ALLOWED_PERMISSIONS = ['android.permission.USE_BIOMETRIC', 'android.permission.USE_FINGERPRINT', 'android.permission.VIBRATE'];

const isLabComponent = (name) => /DesignLabActivity/.test(name) || name.startsWith('com.kokonadahealth.lab.');

/** Problems in the merged manifest of a variant that can be uploaded. [] when clean. */
export function checkUploadManifest(xml) {
  const f = manifestFacts(xml);
  const problems = [];
  if (f.package && f.package.endsWith(LAB_PACKAGE_SUFFIX)) problems.push(`declares the lab package ${f.package}`);
  for (const c of f.components) {
    if (isLabComponent(c.name) || (c.target && isLabComponent(c.target))) problems.push(`declares the Design Lab component ${c.name}`);
  }
  if (problems.length === 0 && /DesignLabActivity/.test(xml)) problems.push('names DesignLabActivity');
  return problems;
}

/** Problems in the lab's merged manifest. [] when it is the lab as designed. */
export function checkLabManifest(xml) {
  const f = manifestFacts(xml);
  const problems = [];
  if (!f.package || !f.package.endsWith(LAB_PACKAGE_SUFFIX)) problems.push(`is not the lab package (package=${f.package})`);
  if (f.launchers.length !== 1 || f.launchers[0] !== LAB_ACTIVITY) {
    problems.push(`must have exactly one launcher, ${LAB_ACTIVITY}; has [${f.launchers.join(', ')}]`);
  }
  for (const c of f.components) {
    if (REAL_APP_COMPONENTS.includes(c.name) || REAL_APP_COMPONENTS.includes(c.target)) {
      problems.push(`declares the real app's ${c.name.split('.').pop()}`);
    }
  }
  if (f.browsable) problems.push('has a BROWSABLE intent filter: the lab has no deep link');
  const allowed = new Set([...LAB_ALLOWED_PERMISSIONS, `${f.package}.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION`]);
  for (const p of f.permissions) {
    if (p === 'android.permission.INTERNET') problems.push('requests INTERNET');
    else if (p.startsWith('android.permission.health.')) problems.push(`requests the health permission ${p}`);
    else if (RADIO_AND_LOCATION.has(p)) problems.push(`requests ${p}`);
    else if (!allowed.has(p)) problems.push(`requests ${p}, which is not on the lab's permission allow-list`);
  }
  for (const s of f.schemes) {
    if (REAL_APP_SCHEMES.has(s.toLowerCase())) problems.push(`handles the real app's scheme ${s}://`);
  }
  if (f.cleartext !== 'false') problems.push(`allows cleartext traffic (usesCleartextTraffic=${f.cleartext})`);
  return problems;
}

// ---- finding AGP's outputs, and the CLI ---------------------------------------------------

const MANIFEST_KINDS = ['merged_manifest', 'merged_manifests', 'bundle_manifest', 'packaged_manifests'];

/** Every merged manifest under an app module's build dir: [{ variant, kind, file }]. */
export function findMergedManifests(buildDir) {
  const out = [];
  const walk = (dir, visit) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, visit); else visit(full, e.name);
    }
  };
  for (const kind of MANIFEST_KINDS) {
    const root = path.join(buildDir, 'intermediates', kind);
    if (!fs.existsSync(root)) continue;
    for (const variant of fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name)) {
      walk(path.join(root, variant), (file, name) => { if (name === 'AndroidManifest.xml') out.push({ variant, kind, file }); });
    }
  }
  return out.sort((a, b) => a.file.localeCompare(b.file));
}

const isLabVariant = (variant) => variant === 'lab' || /Lab$/.test(variant);

function main(argv) {
  const appRoot = path.resolve(path.dirname(process.argv[1]), '../..');
  let buildDir = path.join(appRoot, 'android/app/build');
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--build-dir') buildDir = path.resolve(argv[++i]);
    else { console.error(`unknown argument: ${argv[i]}`); return 2; }
  }

  let manifests;
  try { manifests = findMergedManifests(buildDir); } catch (e) { console.error(`cannot read ${buildDir}: ${e.message}`); return 2; }
  const variants = new Set(manifests.map((m) => m.variant));
  const missing = ['release', 'lab'].filter((v) => !variants.has(v));
  if (missing.length) {
    console.error(`no merged manifest for: ${missing.join(', ')} under ${buildDir}`);
    console.error('run ./gradlew :app:processReleaseMainManifest :app:processLabMainManifest first; nothing checked is never a pass');
    return 2;
  }

  let failed = false;
  for (const m of manifests) {
    const where = `${m.variant} (${m.kind})`;
    let problems;
    try {
      const xml = fs.readFileSync(m.file, 'utf8');
      problems = isLabVariant(m.variant) ? checkLabManifest(xml) : checkUploadManifest(xml);
    } catch (e) {
      console.error(`${where}: unreadable: ${e.message}`);
      return 2;
    }
    if (problems.length) {
      failed = true;
      console.error(`${where}: ${path.relative(appRoot, m.file)}`);
      for (const p of problems) console.error(`  ${p}`);
    } else {
      console.log(`${where}: ${isLabVariant(m.variant) ? 'the lab as designed' : 'no Design Lab'}`);
    }
  }
  return failed ? 1 : 0;
}

if (process.argv[1] && /assertManifests\.mjs$/.test(process.argv[1])) {
  process.exitCode = main(process.argv.slice(2));
}
