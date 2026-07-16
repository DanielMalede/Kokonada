import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hardenCsp, generateNonce, rotate, readCurrentNonce } from './rotate-csp-nonce.mjs';

const ORIGINAL_VALUE =
  "default-src 'self'; script-src 'self' 'unsafe-inline' https://accounts.google.com https://www.gstatic.com https://appleid.cdn-apple.com https://sdk.scdn.co; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://api.fontshare.com; img-src 'self' data: https:; font-src 'self' data: https://fonts.gstatic.com https://cdn.fontshare.com https://api.fontshare.com; connect-src 'self' https: wss:; frame-src https://accounts.google.com https://appleid.apple.com https://sdk.scdn.co; frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'";

describe('hardenCsp', () => {
  it('drops unsafe-inline from script-src and adds strict-dynamic + the given nonce', () => {
    const out = hardenCsp(ORIGINAL_VALUE, 'TESTNONCE');
    const scriptSrc = out.split(';').find((d) => d.trim().startsWith('script-src'));
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).toContain("'nonce-TESTNONCE'");
    expect(scriptSrc).toContain("'strict-dynamic'");
    // Host allowlist kept as a graceful-degradation fallback.
    expect(scriptSrc).toContain('https://accounts.google.com');
    expect(scriptSrc).toContain('https://sdk.scdn.co');
  });

  it('replaces bare https:/wss: wildcards in connect-src with an explicit allowlist', () => {
    const out = hardenCsp(ORIGINAL_VALUE, 'n1');
    const connectSrc = out.split(';').find((d) => d.trim().startsWith('connect-src'));
    expect(connectSrc).not.toMatch(/\shttps:(\s|;|$)/);
    expect(connectSrc).not.toMatch(/\swss:(\s|;|$)/);
    expect(connectSrc).toContain('https://kokonada-backend-production.up.railway.app');
    expect(connectSrc).toContain('wss://kokonada-backend-production.up.railway.app');
    expect(connectSrc).toContain('https://api.spotify.com');
  });

  it('replaces the bare https: wildcard in img-src with an explicit allowlist', () => {
    const out = hardenCsp(ORIGINAL_VALUE, 'n1');
    const imgSrc = out.split(';').find((d) => d.trim().startsWith('img-src'));
    expect(imgSrc).not.toMatch(/\shttps:(\s|;|$)/);
    expect(imgSrc).toContain('https://i.scdn.co');
    expect(imgSrc).toContain('https://lh3.googleusercontent.com');
  });

  it('is idempotent: rotating an already-hardened policy just swaps the nonce', () => {
    const once = hardenCsp(ORIGINAL_VALUE, 'first');
    const twice = hardenCsp(once, 'second');
    const scriptSrc = twice.split(';').find((d) => d.trim().startsWith('script-src'));
    expect(scriptSrc).toContain("'nonce-second'");
    expect(scriptSrc).not.toContain("'nonce-first'");
    expect((scriptSrc.match(/'nonce-/g) ?? []).length).toBe(1);
    expect((scriptSrc.match(/'strict-dynamic'/g) ?? []).length).toBe(1);
  });
});

describe('generateNonce', () => {
  it('produces a non-empty, unpredictable value that changes on every call', () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });
});

describe('rotate (file I/O)', () => {
  it('promotes Content-Security-Policy-Report-Only to enforcing and rotates the nonce on disk', () => {
    const dir = mkdtempSync(join(tmpdir(), 'csp-test-'));
    const file = join(dir, 'vercel.json');
    writeFileSync(
      file,
      JSON.stringify({
        headers: [{ source: '/(.*)', headers: [{ key: 'Content-Security-Policy-Report-Only', value: ORIGINAL_VALUE }] }],
      }),
    );

    const nonce = rotate({ path: file });

    const written = JSON.parse(readFileSync(file, 'utf8'));
    const header = written.headers[0].headers[0];
    expect(header.key).toBe('Content-Security-Policy');
    expect(header.value).toContain(`'nonce-${nonce}'`);
    // script-src is the directive under test — style-src intentionally keeps
    // 'unsafe-inline' (out of scope; Tailwind/Radix rely on inline style attrs).
    const scriptSrc = header.value.split(';').find((d) => d.trim().startsWith('script-src'));
    expect(scriptSrc).not.toContain("'unsafe-inline'");
  });

  it('rotating twice in a row changes the nonce each time', () => {
    const dir = mkdtempSync(join(tmpdir(), 'csp-test-'));
    const file = join(dir, 'vercel.json');
    writeFileSync(
      file,
      JSON.stringify({
        headers: [{ source: '/(.*)', headers: [{ key: 'Content-Security-Policy-Report-Only', value: ORIGINAL_VALUE }] }],
      }),
    );

    const n1 = rotate({ path: file });
    const n2 = rotate({ path: file });
    expect(n1).not.toBe(n2);
  });
});

describe('readCurrentNonce', () => {
  it('reads back the exact nonce just written by rotate()', () => {
    const dir = mkdtempSync(join(tmpdir(), 'csp-test-'));
    const file = join(dir, 'vercel.json');
    writeFileSync(
      file,
      JSON.stringify({
        headers: [{ source: '/(.*)', headers: [{ key: 'Content-Security-Policy-Report-Only', value: ORIGINAL_VALUE }] }],
      }),
    );

    const nonce = rotate({ path: file });
    expect(readCurrentNonce(file)).toBe(nonce);
  });

  it('returns null when no enforcing CSP header is present', () => {
    const dir = mkdtempSync(join(tmpdir(), 'csp-test-'));
    const file = join(dir, 'vercel.json');
    writeFileSync(file, JSON.stringify({ headers: [] }));
    expect(readCurrentNonce(file)).toBeNull();
  });
});
