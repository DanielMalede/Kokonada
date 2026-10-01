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
    expect(code).not.toMatch(/intent\.data|intent\?\.data|dataString|getStringExtra|extras|getIntent\(/);
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

describe('the copy-me snippet is the shipped activity (M4)', () => {
  it('native-snippets/PermissionsRationaleActivity.kt has the same code as the app’s, comments aside', () => {
    const squash = (s: string) => stripComments(s).replace(/\s+/g, ' ').trim();
    expect(squash(fs.readFileSync(SNIPPET_KT, 'utf8'))).toBe(squash(fs.readFileSync(APP_KT, 'utf8')));
  });
});
