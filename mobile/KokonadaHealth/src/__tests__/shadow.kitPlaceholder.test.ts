/// <reference types="node" />
// PR #309 review (shadow), RA-9 = security L1 = compliance P3: MB-184 fixed the app's BACKEND_URL
// placeholder, but the legacy kit, mobile/src/health/config.ts, still carried
// `https://YOUR-BACKEND.up.railway.app`, a real and claimable Railway name that is not the owner's. The
// kit is copied into a fresh app as its src/ (mobile/SETUP_ANDROID.md, step 3), so a build made from it
// unedited would send a stored token to whoever claims that name. Every config.ts that defines
// BACKEND_URL, in either source tree, must use a host that can never resolve: `.invalid` is reserved
// (RFC 2606, RFC 6761), so a request to it fails at name resolution and no header leaves the device.

import * as fs from 'fs';
import * as path from 'path';

const MOBILE_ROOT = path.resolve(__dirname, '..', '..', '..'); // mobile/
const SOURCE_TREES = [path.join(MOBILE_ROOT, 'src'), path.join(MOBILE_ROOT, 'KokonadaHealth', 'src')];
const CLAIMABLE_HOSTING = /\.(up\.railway\.app|railway\.app|onrender\.com|fly\.dev|vercel\.app|herokuapp\.com|netlify\.app)\b/i;

// The source trees hold no links or junctions; anything that is not a plain directory or file is skipped.
function configFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) configFiles(full, out);
    else if (entry.isFile() && entry.name === 'config.ts' && /\bBACKEND_URL\b/.test(fs.readFileSync(full, 'utf8'))) out.push(full);
  }
  return out;
}

const CONFIGS = SOURCE_TREES.flatMap((t) => configFiles(t));
const rel = (f: string) => path.relative(MOBILE_ROOT, f).replace(/\\/g, '/');

describe('no BACKEND_URL placeholder in any source tree can reach a server (RA-9)', () => {
  it('finds both: the app\'s config and the legacy kit\'s', () => {
    expect(CONFIGS.map(rel).sort()).toEqual(['KokonadaHealth/src/health/config.ts', 'src/health/config.ts']);
  });

  it.each(CONFIGS.map((f) => [rel(f), f]))('%s: BACKEND_URL is https on a host under .invalid, and names no claimable hosting domain', (_l, file) => {
    const source = fs.readFileSync(file, 'utf8');
    const declared = source.match(/export const BACKEND_URL = '([^']*)'/);
    expect(declared).not.toBeNull();
    const url = new URL(declared![1]);
    expect(url.protocol).toBe('https:');
    expect(url.hostname.endsWith('.invalid')).toBe(true);
    expect(source).not.toMatch(CLAIMABLE_HOSTING);
  });

  it('the kit\'s module exports that value at run time', () => {
    const { BACKEND_URL } = require('../../../src/health/config');
    expect(new URL(BACKEND_URL).hostname.endsWith('.invalid')).toBe(true);
  });
});
