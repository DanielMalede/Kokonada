import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hardenCsp, readCsp, VERCEL_JSON_PATH } from './csp.mjs';

const ORIGINAL_VALUE =
  "default-src 'self'; script-src 'self' 'unsafe-inline' https://accounts.google.com https://www.gstatic.com https://appleid.cdn-apple.com https://sdk.scdn.co; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://api.fontshare.com; img-src 'self' data: https:; font-src 'self' data: https://fonts.gstatic.com https://cdn.fontshare.com https://api.fontshare.com; connect-src 'self' https: wss:; frame-src https://accounts.google.com https://appleid.apple.com https://sdk.scdn.co; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'";

// A previously-hardened (nonce-based) value — hardenCsp must be able to normalize this
// back down to the plain, static shape too (regression guard against reintroducing T3-1).
const NONCE_VALUE =
  "default-src 'self'; script-src 'self' https://accounts.google.com https://www.gstatic.com https://appleid.cdn-apple.com https://sdk.scdn.co 'nonce-Abxi3QqWB0kTkJ0+55Qi1w==' 'strict-dynamic'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://api.fontshare.com; img-src 'self' data: https://i.scdn.co https://lh3.googleusercontent.com; font-src 'self' data: https://fonts.gstatic.com https://cdn.fontshare.com https://api.fontshare.com; connect-src 'self' https://kokonada-backend-production.up.railway.app wss://kokonada-backend-production.up.railway.app https://api.spotify.com wss://dealer.spotify.com; frame-src https://accounts.google.com https://appleid.apple.com https://sdk.scdn.co; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'";

describe('hardenCsp', () => {
  it('drops unsafe-inline from script-src and keeps the explicit host allowlist', () => {
    const out = hardenCsp(ORIGINAL_VALUE);
    const scriptSrc = out.split(';').find((d) => d.trim().startsWith('script-src'));
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).toContain('https://accounts.google.com');
    expect(scriptSrc).toContain('https://sdk.scdn.co');
  });

  // T3-1 / T3-3: a nonce here can never match the served HTML the way this project
  // deploys, and with 'strict-dynamic' disabling the host allowlist a static, publicly
  // -readable nonce is no real protection anyway. The hardened shape has neither.
  it('never adds a nonce or strict-dynamic — the pinned regression against T3-1', () => {
    const out = hardenCsp(ORIGINAL_VALUE);
    const scriptSrc = out.split(';').find((d) => d.trim().startsWith('script-src'));
    expect(scriptSrc).not.toMatch(/'nonce-/);
    expect(scriptSrc).not.toContain("'strict-dynamic'");
  });

  it('normalizes an already-nonced policy back down to the plain static shape', () => {
    const out = hardenCsp(NONCE_VALUE);
    const scriptSrc = out.split(';').find((d) => d.trim().startsWith('script-src'));
    expect(scriptSrc).not.toMatch(/'nonce-/);
    expect(scriptSrc).not.toContain("'strict-dynamic'");
    expect(scriptSrc).toContain('https://accounts.google.com');
  });

  it('replaces bare https:/wss: wildcards in connect-src with an explicit allowlist, including the auth SDK hosts (T3-2)', () => {
    const out = hardenCsp(ORIGINAL_VALUE);
    const connectSrc = out.split(';').find((d) => d.trim().startsWith('connect-src'));
    expect(connectSrc).not.toMatch(/\shttps:(\s|;|$)/);
    expect(connectSrc).not.toMatch(/\swss:(\s|;|$)/);
    expect(connectSrc).toContain('https://kokonada-backend-production.up.railway.app');
    expect(connectSrc).toContain('wss://kokonada-backend-production.up.railway.app');
    expect(connectSrc).toContain('https://api.spotify.com');
    expect(connectSrc).toContain('https://accounts.google.com');
    expect(connectSrc).toContain('https://www.googleapis.com');
    expect(connectSrc).toContain('https://appleid.apple.com');
  });

  it('replaces the bare https: wildcard in img-src with an explicit allowlist covering Spotify art CDN subdomains (T3-4)', () => {
    const out = hardenCsp(ORIGINAL_VALUE);
    const imgSrc = out.split(';').find((d) => d.trim().startsWith('img-src'));
    expect(imgSrc).not.toMatch(/\shttps:(\s|;|$)/);
    expect(imgSrc).toContain('https://*.scdn.co');
    expect(imgSrc).toContain('https://*.spotifycdn.com');
    expect(imgSrc).toContain('https://lh3.googleusercontent.com');
  });

  it('is idempotent: hardening an already-hardened policy is a no-op', () => {
    const once = hardenCsp(ORIGINAL_VALUE);
    const twice = hardenCsp(once);
    expect(twice).toBe(once);
  });
});

describe('readCsp', () => {
  it('reads back the Content-Security-Policy header value from a vercel.json-shaped file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'csp-test-'));
    const file = join(dir, 'vercel.json');
    writeFileSync(
      file,
      JSON.stringify({
        headers: [{ source: '/(.*)', headers: [{ key: 'Content-Security-Policy', value: ORIGINAL_VALUE }] }],
      }),
    );
    expect(readCsp(file)).toEqual({ key: 'Content-Security-Policy', value: ORIGINAL_VALUE });
  });

  it('returns null when no CSP header is present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'csp-test-'));
    const file = join(dir, 'vercel.json');
    writeFileSync(file, JSON.stringify({ headers: [] }));
    expect(readCsp(file)).toBeNull();
  });
});

// Real-file regression guard (resilience audit: "hunts false-greens" — a pure-function
// unit test alone can't catch the committed file drifting out of the hardened shape).
// Reads the ACTUAL committed frontend/vercel.json, not a fixture.
describe('the committed vercel.json CSP (regression guard)', () => {
  it('is enforcing (not Report-Only) and already in the canonical hardened shape', () => {
    const current = readCsp(VERCEL_JSON_PATH);
    expect(current).not.toBeNull();
    expect(current.key).toBe('Content-Security-Policy');
    expect(hardenCsp(current.value)).toBe(current.value);
  });

  it('carries no nonce and no strict-dynamic (T3-1: these can never match on a real deploy)', () => {
    const { value } = readCsp(VERCEL_JSON_PATH);
    expect(value).not.toMatch(/'nonce-/);
    expect(value).not.toContain("'strict-dynamic'");
  });
});
