/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';

// HX-5 (CMP-067; compliance brief M2, T3). Health Connect reaches the app's privacy policy through
// two manifest entry points, and both must land on PermissionsRationaleActivity:
//   - Android 13 and below: the androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE intent-filter,
//     declared once, on that activity only (it used to sit on MainActivity as well);
//   - Android 14 and above: the ViewPermissionUsageActivity alias, which must TARGET that activity
//     (it used to target MainActivity, so the link opened the home screen) and must keep the
//     START_VIEW_PERMISSION_USAGE permission, the action, the category and exported="true".
// The manifest is parsed after comments are stripped, so a comment naming an action can neither
// satisfy nor fail a check. The same rules hold for the copy-me fragment in mobile/native-snippets.

const MOBILE = path.resolve(__dirname, '../../../..');
const MANIFEST = path.join(MOBILE, 'KokonadaHealth/android/app/src/main/AndroidManifest.xml');
const SNIPPET = path.join(MOBILE, 'native-snippets/AndroidManifest.additions.xml');

const RATIONALE_ACTION = 'androidx.health.ACTION_SHOW_PERMISSIONS_RATIONALE';
const RATIONALE_ACTIVITY = '.PermissionsRationaleActivity';

interface El { name: string; attrs: Record<string, string>; children: El[]; parent: El | null; order: number }

// A small, strict parser for the element/attribute structure (no text content needed). It throws
// on a mismatched or unclosed tag rather than guessing.
function parse(xml: string): El {
  const src = xml.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?[\s\S]*?\?>/g, '');
  const root: El = { name: '#root', attrs: {}, children: [], parent: null, order: -1 };
  const stack: El[] = [root];
  const tag = /<(\/?)([\w:.-]+)((?:\s+[\w:.-]+\s*=\s*"[^"]*")*)\s*(\/?)>/g;
  let order = 0;
  for (const m of src.matchAll(tag)) {
    const [, closing, name, rawAttrs, selfClosing] = m;
    if (closing) {
      const top = stack.pop();
      if (!top || top.name !== name) throw new Error(`mismatched </${name}>`);
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of rawAttrs.matchAll(/([\w:.-]+)\s*=\s*"([^"]*)"/g)) attrs[a[1]] = a[2];
    const el: El = { name, attrs, children: [], parent: stack[stack.length - 1], order: order++ };
    el.parent!.children.push(el);
    if (!selfClosing) stack.push(el);
  }
  if (stack.length !== 1) throw new Error(`unclosed <${stack[stack.length - 1].name}>`);
  return root;
}

const all = (el: El): El[] => el.children.flatMap((c) => [c, ...all(c)]);
const named = (root: El, tagName: string) => all(root).filter((e) => e.name === tagName);
const ancestor = (el: El, tagName: string): El | null => {
  for (let p = el.parent; p; p = p.parent) if (p.name === tagName) return p;
  return null;
};
const nameOf = (el: El | null) => el?.attrs['android:name'];

// The <uses-permission> entries the app's own SOURCE manifest declares, which the copy-me snippet
// mirrors; HX-5 adds none and removes none. This is not the list a build ships: the merged manifest
// also carries what libraries add (USE_BIOMETRIC, USE_FINGERPRINT, VIBRATE, androidx.core's receiver
// permission), and before MB-093 it also carried rxandroidble's uncapped API 23+ location. What ships
// is checked on the merged manifest, in CI's Android job, by scripts/lab/assertManifests.mjs against
// the allow-list in scripts/lab/uploadPermissions.mjs (MB-093).
const SOURCE_PERMISSIONS = [
  'android.permission.INTERNET',
  'android.permission.health.READ_HEART_RATE',
  'android.permission.health.READ_HEART_RATE_VARIABILITY',
  'android.permission.health.READ_SLEEP',
  'android.permission.health.READ_RESTING_HEART_RATE',
  'android.permission.health.READ_HEALTH_DATA_HISTORY',
  'android.permission.BLUETOOTH_SCAN usesPermissionFlags=neverForLocation',
  'android.permission.BLUETOOTH_CONNECT',
  'android.permission.BLUETOOTH maxSdkVersion=30',
  'android.permission.BLUETOOTH_ADMIN maxSdkVersion=30',
  'android.permission.ACCESS_FINE_LOCATION maxSdkVersion=30',
];
const permissionsOf = (root: El) => named(root, 'uses-permission').map((p) =>
  [nameOf(p), ...Object.entries(p.attrs).filter(([k]) => k !== 'android:name').map(([k, v]) => `${k.replace('android:', '')}=${v}`)].join(' '));

function rationaleRules(root: El) {
  const rationaleActions = named(root, 'action').filter((a) => nameOf(a) === RATIONALE_ACTION);
  const activity = named(root, 'activity').find((a) => nameOf(a) === RATIONALE_ACTIVITY);
  const aliases = named(root, 'activity-alias').filter((alias) => {
    const filter = alias.children.find((c) => c.name === 'intent-filter');
    return !!filter
      && filter.children.some((c) => c.name === 'action' && nameOf(c) === 'android.intent.action.VIEW_PERMISSION_USAGE')
      && filter.children.some((c) => c.name === 'category' && nameOf(c) === 'android.intent.category.HEALTH_PERMISSIONS');
  });
  return { rationaleActions, activity, aliases };
}

describe.each([
  ['AndroidManifest.xml', MANIFEST],
  ['native-snippets/AndroidManifest.additions.xml', SNIPPET],
])('%s — both Health Connect entry points land on the rationale activity', (_label, file) => {
  const root = parse(`<fragment>${fs.readFileSync(file, 'utf8')}</fragment>`);
  const { rationaleActions, activity, aliases } = rationaleRules(root);

  it('the Android 13-and-below action is declared exactly once, on PermissionsRationaleActivity', () => {
    // Each declaration, named by the activity that owns it (a bare filter in the fragment has none).
    const owners = rationaleActions.map((a) => nameOf(ancestor(a, 'activity')) ?? '(no activity)');
    expect(owners).toEqual([RATIONALE_ACTIVITY]);
  });

  it('PermissionsRationaleActivity is exported with its single intent-filter', () => {
    expect(activity).toBeDefined();
    expect(activity!.attrs['android:exported']).toBe('true');
    expect(activity!.children.filter((c) => c.name === 'intent-filter')).toHaveLength(1);
  });

  it('exactly one Android 14+ alias, targeting PermissionsRationaleActivity, with its permission and export unchanged', () => {
    expect(aliases).toHaveLength(1);
    expect(aliases[0].attrs).toEqual({
      'android:name': 'ViewPermissionUsageActivity',
      'android:exported': 'true',
      'android:targetActivity': RATIONALE_ACTIVITY,
      'android:permission': 'android.permission.START_VIEW_PERMISSION_USAGE',
    });
  });

  it('the activity precedes its alias (an alias must follow its target)', () => {
    expect(activity!.order).toBeLessThan(aliases[0].order);
  });

  it('its own <uses-permission> entries are unchanged, none added and none removed (a source list: what ships is checked on the merged manifest)', () => {
    expect(permissionsOf(root)).toEqual(SOURCE_PERMISSIONS);
  });
});

describe('AndroidManifest.xml — MainActivity no longer answers Health Connect', () => {
  const root = parse(fs.readFileSync(MANIFEST, 'utf8'));
  const main = named(root, 'activity').find((a) => nameOf(a) === '.MainActivity');

  it('MainActivity is still there, with no rationale action anywhere inside it', () => {
    expect(main).toBeDefined();
    expect(named(main!, 'action').map(nameOf)).not.toContain(RATIONALE_ACTION);
  });

  it('no new exported component: the same three as before', () => {
    const exported = all(root)
      .filter((e) => ['activity', 'activity-alias', 'service', 'receiver', 'provider'].includes(e.name))
      .filter((e) => e.attrs['android:exported'] === 'true')
      .map(nameOf);
    expect(exported).toEqual(['.MainActivity', RATIONALE_ACTIVITY, 'ViewPermissionUsageActivity']);
  });
});

// MB-093. Both the app manifest and the copy-me snippet remove rxandroidble's uncapped API 23+ COARSE
// and FINE location, so a setup copied from the snippet does not bring them back. These pin the
// source; what ships is checked on the merged manifest by scripts/lab/assertManifests.mjs.
describe.each([
  ['AndroidManifest.xml', MANIFEST],
  ['native-snippets/AndroidManifest.additions.xml', SNIPPET],
])('%s — no location beyond the capped FINE entry (MB-093)', (_label, file) => {
  const root = parse(`<fragment>${fs.readFileSync(file, 'utf8')}</fragment>`);

  it('removes rxandroidble’s two uncapped API 23+ location entries', () => {
    const sdk23 = named(root, 'uses-permission-sdk-23').map((p) => `${nameOf(p)} tools:node=${p.attrs['tools:node']}`);
    expect(sdk23).toEqual([
      'android.permission.ACCESS_FINE_LOCATION tools:node=remove',
      'android.permission.ACCESS_COARSE_LOCATION tools:node=remove',
    ]);
  });
});
