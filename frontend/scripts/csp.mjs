// Pure CSP transform + a real-file regression guard for vercel.json's enforcing
// Content-Security-Policy header.
//
// HISTORY (Wave 5 resilience audit, T3-1/T3-3): the original design rotated a fresh
// per-build nonce into vercel.json via a `prebuild` script, then had vite.config.ts
// read that same file back out and stamp the nonce onto the built HTML's <script>
// tags, on the theory that "vercel.json is a static file Vercel reads directly for
// response headers, so the nonce changes per BUILD/release". That theory is wrong for
// how this project actually deploys: Vercel (both the native Git integration and this
// repo's `vercel deploy` CI job) validates/reads vercel.json from the uploaded SOURCE
// BEFORE the Build Command runs remotely — i.e. from the git-committed file — while
// `prebuild` only mutates the file inside Vercel's own ephemeral remote build
// container, AFTER that read already happened. The header nonce (from the commit) and
// the HTML nonce (freshly regenerated every build) therefore could never match on any
// real deploy, and because 'strict-dynamic' makes the host allowlist inert on a nonce
// mismatch, EVERY script on the page — including the entry bundle — would have been
// blocked: a guaranteed blank/broken production app on every single deploy.
//
// A per-request nonce needs Vercel Edge Middleware (out of scope for this pass — see
// the PR description); a per-build nonce baked into a pre-build-read static file is not
// achievable at all. Rather than ship something that LOOKS hardened but is silently
// broken by Vercel's own timing, this policy is now fully static: no nonce, no
// 'strict-dynamic', no build-time mutation. All first-party scripts are 'self'
// (Vite-bundled) and every third-party script this app loads is injected via
// `document.createElement('script')` with an explicit, already-known host (Google
// Identity Services, Apple's JS SDK, the Spotify Web Playback SDK) — so a plain host
// allowlist actually restricts script origins (unlike a nonce whose only real
// protection, with 'strict-dynamic' already disabling the host list, is a value that's
// public in every response anyway — see the audit's "security theater" finding, T3-3).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const VERCEL_JSON_PATH = resolve(__dirname, '..', 'vercel.json');

const BACKEND_ORIGIN = 'https://kokonada-backend-production.up.railway.app';

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
 * Pure transform: given the CURRENT CSP value (whatever shape it's in), returns the
 * hardened, fully-static value. Idempotent — safe to run on an already-hardened policy
 * (no-op) or on the original Report-Only/unsafe-inline/nonce one (normalizes it).
 */
export function hardenCsp(currentValue) {
  const directives = parseCsp(currentValue);
  const byName = new Map(directives.map(([name, tokens], i) => [name, i]));

  function setDirective(name, tokens) {
    if (byName.has(name)) directives[byName.get(name)] = [name, tokens];
    else directives.push([name, tokens]);
  }

  // script-src: drop 'unsafe-inline' and any nonce/strict-dynamic (a nonce here can
  // never match the HTML the way this project deploys — see file header) — keep the
  // explicit host allowlist, which is the ONLY thing actually enforcing this directive.
  const scriptIdx = byName.get('script-src');
  const prevScriptTokens = scriptIdx !== undefined ? directives[scriptIdx][1] : ["'self'"];
  const keptScriptTokens = prevScriptTokens.filter(
    (t) => t !== "'unsafe-inline'" && t !== "'strict-dynamic'" && !/^'nonce-/.test(t),
  );
  setDirective('script-src', keptScriptTokens.length ? keptScriptTokens : ["'self'"]);

  // connect-src: no bare https:/wss: wildcards — explicit backend + Spotify hosts, plus
  // the Google/Apple auth hosts the sign-in SDKs already loaded by this app call directly
  // (missing these would silently break sign-in — audit T3-2).
  setDirective('connect-src', [
    "'self'",
    BACKEND_ORIGIN,
    BACKEND_ORIGIN.replace('https://', 'wss://'),
    'https://api.spotify.com',
    'wss://dealer.spotify.com',
    'https://accounts.google.com',
    'https://www.googleapis.com',
    'https://appleid.apple.com',
  ]);

  // img-src: no bare https: wildcard — Spotify serves cover art from several *.scdn.co /
  // *.spotifycdn.com subdomains (not just i.scdn.co), so a single explicit host would
  // 404-render some tracks' art (audit T3-4); wildcard subdomains, plus Google avatars.
  setDirective('img-src', [
    "'self'",
    'data:',
    'https://*.scdn.co',
    'https://*.spotifycdn.com',
    'https://lh3.googleusercontent.com',
  ]);

  return serializeCsp(directives);
}

/** Reads the vercel.json Content-Security-Policy header value (enforcing or Report-Only). */
export function readCsp(path = VERCEL_JSON_PATH) {
  const json = JSON.parse(readFileSync(path, 'utf8'));
  for (const rule of json.headers ?? []) {
    for (const header of rule.headers ?? []) {
      if (header.key === 'Content-Security-Policy' || header.key === 'Content-Security-Policy-Report-Only') {
        return { key: header.key, value: header.value };
      }
    }
  }
  return null;
}
