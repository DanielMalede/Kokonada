import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { generateExtensionsModule, generateTokensModule } from '../lib/emit.mjs';
import { readTokenSources } from '../lib/sources.mjs';

// UI-104. CI's secret scan (gitleaks 8.24.3, .github/workflows/ci.yml) read every source-hash line
// the generator wrote, `'base.tokens.json': '<sha256>',`, as a `generic-api-key` leak: the key holds
// the keyword "token", then a colon, then 64 hex characters whose entropy is above the rule's 3.5.
// The hashes are sha256 digests of the token source files, not secrets, so the generator now keys
// them by the file's stem (`base`, `'direction.abyss'`), which holds no keyword. This test scans
// both generated modules, and the generator's output for the real sources, the way gitleaks does.

// GENERIC_API_KEY mirrors the `generic-api-key` rule of gitleaks 8.24.3 (config/gitleaks.toml):
//   regex   (?i)[\w.-]{0,50}?(?:access|auth|(?-i:[Aa]pi|API)|credential|creds|key|passw(?:or)?d|secret|token)
//           (?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[\x60'"\s=]{0,5}
//           ([\w.=-]{10,150}|[a-z0-9][a-z0-9+/]{11,}={0,3})(?:[\x60'"\s;]|\\[nr]|$)
//   entropy 3.5, on the captured group.
// JavaScript has no inline flags, so the whole pattern takes `i`; the case-sensitive `[Aa]pi|API`
// branch is then matched in every case, which only widens it. Like gitleaks, it runs over the whole
// text (`$` is the end of the text, and `\s` may cross a line). The rule's allowlists (its stopwords,
// and the digit a generic secret must hold) are left out: this scan finds every hit gitleaks finds,
// and possibly more, never fewer.
const GENERIC_API_KEY =
  /[\w.-]{0,50}?(?:access|auth|api|credential|creds|key|passw(?:or)?d|secret|token)(?:[ \t\w.-]{0,20})[\s'"]{0,3}(?:=|>|:{1,3}=|\|\||:|=>|\?=|,)[`'"\s=]{0,5}([\w.=-]{10,150}|[a-z0-9][a-z0-9+/]{11,}={0,3})(?:[`'"\s;]|\\[nr]|$)/gi;
const ENTROPY = 3.5;

/** Shannon entropy in bits per character, as gitleaks computes it. */
function entropy(s: string): number {
  const counts = new Map<string, number>();
  for (const c of s) counts.set(c, (counts.get(c) ?? 0) + 1);
  let bits = 0;
  for (const n of counts.values()) {
    const p = n / s.length;
    bits -= p * Math.log2(p);
  }
  return bits;
}

type Hit = { line: number; secret: string };

/** Every `generic-api-key` finding in `text`, with the 1-based line it starts on. */
function scan(text: string): Hit[] {
  const hits: Hit[] = [];
  for (const m of text.matchAll(GENERIC_API_KEY)) {
    if (entropy(m[1]) > ENTROPY) {
      hits.push({ line: text.slice(0, m.index).split('\n').length, secret: m[1] });
    }
  }
  return hits;
}

const APP_ROOT = path.resolve(__dirname, '../../..');
const DESIGN_TOKENS = path.resolve(APP_ROOT, '../../design-tokens');
const GENERATED = path.join(APP_ROOT, 'src/design/v2/tokens/tokens.generated.ts');
const GENERATED_EXTENSIONS = path.join(APP_ROOT, 'src/design/v2/tokens/tokens.extensions.generated.ts');
type Source = { name: string; bytes: Buffer; json: unknown };
const real = (): Source[] => readTokenSources(DESIGN_TOKENS);
const sha256 = (bytes: Buffer) => crypto.createHash('sha256').update(bytes).digest('hex');

describe('the scan mirrors gitleaks generic-api-key, so a clean result means something', () => {
  it('finds the line shape CI flagged, a source file name keyed to its sha256, with the hash as the secret', () => {
    for (const s of real()) {
      const line = ['', `  '${s.name}': '${sha256(s.bytes)}',`, ''].join('\n');
      expect(scan(line)).toEqual([{ line: 2, secret: sha256(s.bytes) }]);
    }
  });

  it('passes a keyword with a low-entropy value, and a high-entropy value under no keyword', () => {
    expect(scan("  'base.tokens.json': 'aaaaaaaaaaaaaaaaaaaaaaaa',")).toEqual([]);
    expect(scan(`  base: '${sha256(Buffer.from('x'))}',`)).toEqual([]);
  });

  it('this test file holds no finding itself', () => {
    expect(scan(fs.readFileSync(__filename, 'utf8'))).toEqual([]);
  });
});

describe('no line of the generated token modules reads as a generic-api-key leak (UI-104)', () => {
  it('tokens.generated.ts, as committed', () => {
    expect(scan(fs.readFileSync(GENERATED, 'utf8'))).toEqual([]);
  });

  it('tokens.extensions.generated.ts, as committed', () => {
    expect(scan(fs.readFileSync(GENERATED_EXTENSIONS, 'utf8'))).toEqual([]);
  });

  it("the generator's output for the real sources", () => {
    expect(scan(generateTokensModule(real()))).toEqual([]);
    expect(scan(generateExtensionsModule(real()))).toEqual([]);
  });
});
