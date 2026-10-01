/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';

// HX-5 (CMP-066; compliance brief M3, T4). PermissionsRationaleActivity is the screen Health Connect
// opens from its privacy-policy link. It is EXPORTED, it hosts a WebView, and Health Connect
// requires it to show the app's own privacy policy. This is a static guard over the Kotlin source:
// it pins the structure that keeps the WebView to the policy alone and never leaves a blank
// screen. What the code DOES is proven on the device (the PR's device list), not here.
//
// Comments are stripped before any match, so a comment can neither satisfy nor fail a check.

const MOBILE = path.resolve(__dirname, '../../../..');
const APP_KT = path.join(MOBILE, 'KokonadaHealth/android/app/src/main/java/com/kokonadahealth/PermissionsRationaleActivity.kt');
const SNIPPET_KT = path.join(MOBILE, 'native-snippets/PermissionsRationaleActivity.kt');

// Kotlin source without // and /* */ comments; string literals (including """raw""") are kept.
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  while (i < src.length) {
    if (src.startsWith('"""', i)) {
      const end = src.indexOf('"""', i + 3);
      const stop = end < 0 ? src.length : end + 3;
      out += src.slice(i, stop); i = stop;
    } else if (src[i] === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1); i = j + 1;
    } else if (src.startsWith('//', i)) {
      while (i < src.length && src[i] !== '\n') i += 1;
    } else if (src.startsWith('/*', i)) {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 2;
    } else { out += src[i]; i += 1; }
  }
  return out;
}

// The brace-balanced body of `fun <name>(…)`, or '' when there is no such function.
function body(src: string, name: string): string {
  const at = src.search(new RegExp(`fun\\s+${name}\\s*\\(`));
  if (at < 0) return '';
  const open = src.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') { depth -= 1; if (depth === 0) return src.slice(open, i + 1); }
  }
  return '';
}

const code = stripComments(fs.readFileSync(APP_KT, 'utf8'));

describe('PermissionsRationaleActivity — only the policy loads inside it (R13, R14, R17)', () => {
  it('loads the policy from the string resource, exactly once', () => {
    expect(code).toMatch(/getString\(\s*R\.string\.privacy_policy_url\s*\)/);
    expect(code.match(/\.loadUrl\(/g) ?? []).toHaveLength(1);
  });

  it('keeps a link in the WebView only on an exact scheme + host + path match (no prefix, suffix or regex test)', () => {
    const route = body(code, 'shouldOverrideUrlLoading');
    expect(route).not.toBe('');
    expect(code).toMatch(/\.scheme\s*==\s*"https"/);
    expect(code).toMatch(/\.host\s*==\s*\w+\.host/);
    expect(code).toMatch(/\.path\s*==\s*\w+\.path/);
    expect(code).not.toMatch(/startsWith|endsWith|\.contains\(|Regex|\.matches\(|Pattern\./);
    // The policy is the only URL the WebView may load; every other URL is consumed (true).
    expect(route.match(/return\s+false\b/g) ?? []).toHaveLength(1);
    expect(route).toMatch(/if\s*\(\s*isPolicy\(\s*url\s*,\s*policy\s*\)\s*\)\s*return\s+false/);
    expect(route).toMatch(/return\s+true\s*\}$/);
    expect(code.replace(/\s+/g, ' ')).toContain(
      'private fun isPolicy(url: Uri, policy: Uri): Boolean = url.scheme == "https" && url.host == policy.host && url.port == policy.port && url.path == policy.path private fun openOutside(',
    );
  });

  it('only a tapped link leaves, only to a browsable http(s)/mailto handler, and only a finish on the policy counts', () => {
    const route = body(code, 'shouldOverrideUrlLoading');
    expect(route).toMatch(/else\s+if\s*\(\s*request\.hasGesture\(\)\s*\)\s*\{?\s*openOutside\(\s*url\s*\)/);
    expect(route.match(/openOutside\(/g) ?? []).toHaveLength(1);
    const outside = body(code, 'openOutside');
    expect(outside).toMatch(/if\s*\(\s*scheme\s+!in\s+OUTSIDE_SCHEMES\s*\)\s*return\b/);
    expect(outside.indexOf('!in OUTSIDE_SCHEMES')).toBeLessThan(outside.indexOf('startActivity('));
    expect(outside).toMatch(/\.addCategory\(\s*Intent\.CATEGORY_BROWSABLE\s*\)/);
    expect(body(code, 'onPageFinished')).toMatch(/if\s*\(\s*url\s*!=\s*null\s*&&\s*isPolicy\(\s*Uri\.parse\(\s*url\s*\)\s*,\s*policy\s*\)\s*\)\s*policyLoaded\s*=\s*true\s+else\s+showFallback\(\)/);
    expect(code.match(/policyLoaded\s*=\s*true/g) ?? []).toHaveLength(1);
    expect(body(code, 'showFallback')).toMatch(/^\{\s*if\s*\(\s*fellBack\s*\)\s*return\b/);
  });

  it('hands any other web or mail link to another app with ACTION_VIEW, and survives there being none', () => {
    expect(code).toMatch(/Intent\.ACTION_VIEW/);
    expect(code).toMatch(/catch\s*\(\s*\w+\s*:\s*ActivityNotFoundException\s*\)/);
    expect(code).toMatch(/setOf\(\s*"https"\s*,\s*"http"\s*,\s*"mailto"\s*\)/);
    expect(code).not.toMatch(/parseUri/);
  });

  it('never returns a bare `false` for every URL (the old open-browser-inside-the-app override)', () => {
    expect(code).not.toMatch(/shouldOverrideUrlLoading\s*\([^)]*\)\s*:\s*Boolean\s*=\s*false/);
  });
});

describe('a page that cannot be shown falls back to text with the address — never a blank screen', () => {
  it('a main-frame load error falls back (a sub-resource error does not)', () => {
    const b = body(code, 'onReceivedError');
    expect(b).toMatch(/isForMainFrame/);
    expect(b).toMatch(/showFallback\(/);
  });

  it('a main-frame HTTP status of 400 or more falls back', () => {
    const b = body(code, 'onReceivedHttpError');
    expect(b).toMatch(/isForMainFrame/);
    expect(b).toMatch(/statusCode\s*>=\s*400/);
    expect(b).toMatch(/showFallback\(/);
  });

  it('a certificate error is cancelled, never proceeded, and falls back (R12)', () => {
    const b = body(code, 'onReceivedSslError');
    expect(b).toMatch(/\.cancel\(\)/);
    expect(b).toMatch(/showFallback\(/);
    expect(code).not.toMatch(/\.proceed\(/);
  });

  it('a page that finishes anywhere but the policy (a redirect away) falls back', () => {
    const b = body(code, 'onPageFinished');
    expect(b).toMatch(/isPolicy\(/);
    expect(b).toMatch(/showFallback\(/);
  });

  it('a crashed renderer falls back instead of taking the app down', () => {
    const b = body(code, 'onRenderProcessGone');
    expect(b).toMatch(/showFallback\(/);
    expect(b).toMatch(/return\s+true/);
  });

  it('the fallback shows the address from the same resource as selectable text', () => {
    const b = body(code, 'fallbackView');
    expect(b).toMatch(/R\.string\.privacy_policy_url/);
    expect(b).toMatch(/setTextIsSelectable\(\s*true\s*\)/);
    expect(b).toMatch(/R\.string\.privacy_policy_unavailable/);
  });
});

describe('the WebView is hardened, and the exported activity trusts nothing it is sent (R14, R15, R16)', () => {
  it('JavaScript, file and content access are switched off explicitly', () => {
    expect(code).toMatch(/javaScriptEnabled\s*=\s*false/);
    expect(code).toMatch(/allowFileAccess\s*=\s*false/);
    expect(code).toMatch(/allowContentAccess\s*=\s*false/);
    expect(code).not.toMatch(/javaScriptEnabled\s*=\s*true/);
  });

  it('no JS bridge and no remote debugging', () => {
    expect(code).not.toMatch(/addJavascriptInterface/);
    expect(code).not.toMatch(/setWebContentsDebuggingEnabled/);
  });

  it('never reads the launching Intent', () => {
    expect(code).not.toMatch(/\bintent\b|dataString|getStringExtra|extras|getIntent\(/);
  });

  it('applies system-bar and cutout insets (edge-to-edge is forced at targetSdk 36)', () => {
    expect(code).toMatch(/setOnApplyWindowInsetsListener/);
    expect(code).toMatch(/systemBars\(\)/);
    expect(code).toMatch(/displayCutout\(\)/);
  });

  it('leaves Back to the system (no onBackPressed override; predictive back never calls it)', () => {
    expect(code).not.toMatch(/onBackPressed/);
  });

  it('destroys the WebView when the screen goes', () => {
    expect(body(code, 'onDestroy')).toMatch(/\.destroy\(\)/);
  });
});

describe('every string the activity reads exists (a missing one fails the Android build, not jest)', () => {
  it('each R.string.<name> in the activity is defined in res/values/strings.xml', () => {
    const strings = fs.readFileSync(path.join(MOBILE, 'KokonadaHealth/android/app/src/main/res/values/strings.xml'), 'utf8');
    const used = [...new Set([...code.matchAll(/R\.string\.(\w+)/g)].map((m) => m[1]))].sort();
    expect(used).toEqual(['privacy_policy_label', 'privacy_policy_open_in_browser', 'privacy_policy_unavailable', 'privacy_policy_url']);
    const missing = used.filter((name) => !new RegExp(`<string\\s+name="${name}"[^>]*>[^<]+</string>`).test(strings));
    expect(missing).toEqual([]);
  });
});

// Round 1 (resilience N1–N4; designer changes 3–6). Static pins only: what they do on screen is in
// the device list.
const raw = fs.readFileSync(APP_KT, 'utf8');

describe('round 1: the crash, stall and tap paths (resilience N1–N4)', () => {
  it('N1: a dead renderer is detached before the fallback shows, and destroyed after', () => {
    expect(body(code, 'onRenderProcessGone')).toMatch(
      /^\{\s*val\s+dead\s*=\s*webView\s+webView\s*=\s*null\s+dead\?\.let\s*\{\s*frame\.removeView\(\s*it\s*\)\s*\}\s+showFallback\(\)\s+dead\?\.destroy\(\)\s+return\s+true\s*\}$/,
    );
  });

  it('N2: a WebView that cannot be built (a missing or updating provider) falls back instead of crashing', () => {
    expect(code).toMatch(/val\s+web\s*=\s*try\s*\{\s*WebView\(this\)\s*\}\s*catch\s*\(\s*\w+\s*:\s*RuntimeException\s*\)\s*\{\s*showFallback\(\)\s*;?\s*return\s*\}/);
  });

  it('N3: a load that neither finishes nor fails falls back after LOAD_TIMEOUT_MS, and the timer dies with the screen', () => {
    expect(code).toMatch(/private\s+val\s+loadWatchdog\s*=\s*Runnable\s*\{\s*if\s*\(\s*!policyLoaded\s*\)\s*showFallback\(\)\s*\}/);
    expect(code).toMatch(/\.loadUrl\(policy\.toString\(\)\)\s+frame\.postDelayed\(\s*loadWatchdog\s*,\s*LOAD_TIMEOUT_MS\s*\)/);
    expect(body(code, 'onDestroy')).toMatch(/^\{\s*if\s*\(\s*::frame\.isInitialized\s*\)\s*frame\.removeCallbacks\(\s*loadWatchdog\s*\)/);
    expect(code).toMatch(/const\s+val\s+LOAD_TIMEOUT_MS\s*=\s*15_000L/);
  });

  it('N4: a tap while the policy is still loading is a tap, not a redirect away', () => {
    expect(body(code, 'shouldOverrideUrlLoading')).toMatch(
      /if\s*\(\s*request\.isForMainFrame\s*&&\s*\(\s*request\.isRedirect\s*\|\|\s*\(\s*!policyLoaded\s*&&\s*!request\.hasGesture\(\)\s*\)\s*\)\s*\)/,
    );
  });
});

describe('round 1: the fallback screen (designer changes 3–6)', () => {
  const fallback = body(code, 'fallbackView');

  it('3: the button reads in sentence case (AppCompat would set it in capitals)', () => {
    expect(fallback).toMatch(/open\.text\s*=\s*getString\(\s*R\.string\.privacy_policy_open_in_browser\s*\)\s+open\.isAllCaps\s*=\s*false/);
  });

  it('4: light status and navigation bars in Day, dark in Nocturne, set after the content view', () => {
    const create = body(code, 'onCreate');
    expect(create).toMatch(/val\s+night\s*=\s*\(\s*resources\.configuration\.uiMode\s+and\s+Configuration\.UI_MODE_NIGHT_MASK\s*\)\s*==\s*Configuration\.UI_MODE_NIGHT_YES/);
    expect(create).toMatch(/WindowCompat\.getInsetsController\(\s*window\s*,\s*window\.decorView\s*\)\.apply\s*\{\s*isAppearanceLightStatusBars\s*=\s*!night\s+isAppearanceLightNavigationBars\s*=\s*!night\s*\}/);
    expect(create.indexOf('setContentView(frame)')).toBeGreaterThanOrEqual(0);
    expect(create.indexOf('setContentView(frame)')).toBeLessThan(create.indexOf('WindowCompat.getInsetsController'));
  });

  it('5: the three texts align to the layout start edge (one start edge under RTL); the button keeps its centred label', () => {
    for (const v of ['heading', 'reason', 'address']) {
      expect(fallback).toMatch(new RegExp(`${v}\\.textAlignment\\s*=\\s*View\\.TEXT_ALIGNMENT_VIEW_START`));
    }
    expect(fallback.match(/TEXT_ALIGNMENT_VIEW_START/g) ?? []).toHaveLength(3);
  });

  it('6: no magic numbers — each size is a named constant naming the token it mirrors', () => {
    expect(fallback).not.toMatch(/\b[1-9]\d*(\.\d+)?f?\b/);
    const constants: Array<[string, string, string]> = [
      ['EDGE_DP', '24', 'space.xl'],
      ['GAP_DP', '16', 'space.lg'],
      ['TIGHT_DP', '8', 'space.sm'],
      ['HEADING_SP', '22f', 'type.size.heading'],
      ['BODY_SP', '16f', 'type.size.body'],
    ];
    for (const [name, value, token] of constants) {
      expect(raw).toMatch(new RegExp(`const val ${name} = ${value} // ${token.replace(/\./g, '\\.')}`));
    }
  });
});

describe('the copy-me snippet is the shipped activity (M4)', () => {
  it('native-snippets/PermissionsRationaleActivity.kt has the same code as the app’s, comments aside', () => {
    const squash = (s: string) => stripComments(s).replace(/\s+/g, ' ').trim();
    expect(squash(fs.readFileSync(SNIPPET_KT, 'utf8'))).toBe(squash(fs.readFileSync(APP_KT, 'utf8')));
  });
});
