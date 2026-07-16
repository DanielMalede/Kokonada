// Rotates the per-build CSP nonce baked into vercel.json's enforcing
// Content-Security-Policy header, and (idempotently) normalizes the policy to the
// hardened shape: enforcing (not Report-Only), no 'unsafe-inline' in script-src,
// 'strict-dynamic' + a fresh nonce, and explicit host allowlists for connect-src /
// img-src (no bare `https:` / `wss:` wildcards).
//
// Run automatically as the frontend's `prebuild` step (see package.json), so every
// `npm run build` — i.e. every release — ships a fresh nonce. vercel.json is a
// STATIC, git-committed file that Vercel reads directly for response headers, so
// the nonce changes per BUILD/release commit rather than per individual HTTP
// request (a true per-request nonce would require Vercel Edge Middleware, which is
// out of scope for this pass — see the PR description). vite.config.ts reads the
// same committed nonce back out of vercel.json at build time and stamps it onto
// the emitted <script> tags in dist/index.html, so the two always match.
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const VERCEL_JSON_PATH = resolve(__dirname, '..', 'vercel.json');

const BACKEND_ORIGIN = 'https://kokonada-backend-production.up.railway.app';

export function generateNonce() {
  return randomBytes(16).toString('base64');
}

/** Splits a CSP header value into a directive-name -> token-list map, preserving directive order. */
function parseCsp(value) {
  const directives = [];
  for (const raw of value.split(';')) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const [name, ...tokens] = trimmed.split(/\s+/);
    directives.push([name, tokens]);
  }
  return directives;
}

function serializeCsp(directives) {
  return directives.map(([name, tokens]) => [name, ...tokens].join(' ')).join('; ');
}

/**
 * Pure transform: given the CURRENT CSP value (whatever shape it's in) and a fresh
 * nonce, returns the hardened value. Idempotent — safe to run on an already-hardened
 * policy (just rotates the nonce) or on the original Report-Only/unsafe-inline one.
 */
export function hardenCsp(currentValue, nonce) {
  const directives = parseCsp(currentValue);
  const byName = new Map(directives.map(([name, tokens], i) => [name, i]));

  function setDirective(name, tokens) {
    if (byName.has(name)) directives[byName.get(name)] = [name, tokens];
    else directives.push([name, tokens]);
  }

  // script-src: drop 'unsafe-inline' and any stale nonce, keep the rest (host
  // allowlist kept as a graceful-degradation fallback for browsers that don't
  // support strict-dynamic), add strict-dynamic + the fresh nonce.
  const scriptIdx = byName.get('script-src');
  const prevScriptTokens = scriptIdx !== undefined ? directives[scriptIdx][1] : ["'self'"];
  const keptScriptTokens = prevScriptTokens.filter(
    (t) => t !== "'unsafe-inline'" && t !== "'strict-dynamic'" && !/^'nonce-/.test(t),
  );
  setDirective('script-src', [...keptScriptTokens, `'nonce-${nonce}'`, "'strict-dynamic'"]);

  // connect-src: no bare https:/wss: wildcards — explicit backend + Spotify hosts.
  setDirective('connect-src', [
    "'self'",
    BACKEND_ORIGIN,
    BACKEND_ORIGIN.replace('https://', 'wss://'),
    'https://api.spotify.com',
    'wss://dealer.spotify.com',
  ]);

  // img-src: no bare https: wildcard — explicit Spotify cover-art + Google avatar CDNs.
  setDirective('img-src', ["'self'", 'data:', 'https://i.scdn.co', 'https://lh3.googleusercontent.com']);

  return serializeCsp(directives);
}

/**
 * Reads the nonce currently baked into vercel.json's script-src (post-rotation),
 * so the Vite build can stamp the SAME value onto the emitted <script> tags.
 * Returns null if no enforcing CSP / nonce is present yet (e.g. a fresh checkout
 * before the first `npm run build` has run `prebuild`).
 */
export function readCurrentNonce(path = VERCEL_JSON_PATH) {
  const json = JSON.parse(readFileSync(path, 'utf8'));
  for (const rule of json.headers ?? []) {
    for (const header of rule.headers ?? []) {
      if (header.key === 'Content-Security-Policy') {
        const match = header.value.match(/'nonce-([^']+)'/);
        if (match) return match[1];
      }
    }
  }
  return null;
}

export function rotate({ path = VERCEL_JSON_PATH, nonce = generateNonce() } = {}) {
  const raw = readFileSync(path, 'utf8');
  const json = JSON.parse(raw);

  for (const rule of json.headers ?? []) {
    for (const header of rule.headers ?? []) {
      if (header.key === 'Content-Security-Policy-Report-Only' || header.key === 'Content-Security-Policy') {
        header.key = 'Content-Security-Policy'; // promote Report-Only -> enforcing
        header.value = hardenCsp(header.value, nonce);
      }
    }
  }

  writeFileSync(path, `${JSON.stringify(json, null, 2)}\n`);
  return nonce;
}

// Only rotate on direct invocation (`node rotate-csp-nonce.mjs`) — importing this
// module for its exports (e.g. from vite.config.ts) must not have side effects.
// Uses pathToFileURL (not string concatenation) so the comparison is correct on
// Windows, where file URLs need a `file:///C:/...` triple-slash + drive-letter form.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const nonce = rotate();
  console.log(`[csp] rotated nonce -> ${nonce}`);
}
