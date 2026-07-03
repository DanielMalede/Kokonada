// SHADOW QA / SECURITY — permanent regression guards for the tokenStore -> AuthSession
// migration. These encode CONTRACTS the migration must satisfy; they are green against
// the current tree and stay green for a CORRECT migration, but break loudly on the
// specific regressions a red-team fears:
//   - a credential plane that is no longer wiped on logout  (orphaned JWT)
//   - a second JWT plane / a new tokenStore consumer         (dual read/write)
//   - a token written to disk, logged, or placed in a URL    (leakage)
//
// They are pure fs/static scans + one injected-teardown assertion: no native modules,
// no RN render, so they are deterministic (unlike the flaky RN component suites).

import * as fs from 'fs';
import * as path from 'path';
import { wipeLocalSession, type SessionTeardownDeps } from '../experience/profile/sessionTeardown';

const SRC_ROOT = path.resolve(__dirname, '..');

// ---- source-tree walk -------------------------------------------------------
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walk(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}
const ALL_FILES = walk(SRC_ROOT);
const isTestFile = (f: string) => /[\\/]__tests__[\\/]/.test(f) || /\.test\.(ts|tsx)$/.test(f);
const PROD_FILES = ALL_FILES.filter((f) => !isTestFile(f));
const rel = (f: string) => path.relative(SRC_ROOT, f).replace(/\\/g, '/');
const read = (f: string) => fs.readFileSync(f, 'utf8');

// =============================================================================
// Objective 1 — logout leaves ZERO bytes: every credential plane is purged.
// =============================================================================
describe('logout purges every credential plane (no orphaned JWT)', () => {
  function spyDeps() {
    const calls: string[] = [];
    const rec = (n: string) => () => { calls.push(n); };
    const deps: SessionTeardownDeps = {
      disconnectSocket: rec('socket'),
      disposePlayer: rec('player'),
      clearAuthSession: rec('authSession'),   // unified rotating pair
      clearWatchToken: rec('watchToken'),     // whr_ device token (must survive nothing)
      clearLegacyToken: rec('legacyJwt'),     // com.kokonadahealth.jwt residue
      wipeColdPersistence: rec('cold'),
      resetWarm: rec('warm'),
      resetNowPlaying: rec('now'),
      resetPlaybackError: rec('err'),
      clearCurrentUser: rec('user'),
    };
    return { deps, calls };
  }

  // If the migration deletes tokenStore.ts it MUST NOT drop the legacy-JWT purge:
  // an upgrading user has a token in com.kokonadahealth.jwt written by the pre-migration
  // login. Removing clearLegacyToken here fails to compile — that is the point.
  it('wipes the unified session, the watch token, AND the legacy JWT plane', async () => {
    const { deps, calls } = spyDeps();
    await wipeLocalSession(deps);
    expect(calls).toEqual(expect.arrayContaining(['authSession', 'watchToken', 'legacyJwt']));
  });

  it('drops identity LAST and severs the socket FIRST, each plane exactly once', async () => {
    const { deps, calls } = spyDeps();
    await wipeLocalSession(deps);
    expect(calls[0]).toBe('socket');
    expect(calls[calls.length - 1]).toBe('user');
    expect(new Set(calls).size).toBe(calls.length); // no plane wiped twice, none skipped
  });

  it('a throwing plane never blocks the remaining wipe (identity still cleared)', async () => {
    const { deps, calls } = spyDeps();
    deps.clearAuthSession = () => { throw new Error('keychain busy'); };
    await wipeLocalSession(deps);
    expect(calls).toContain('legacyJwt'); // reached later planes despite the throw
    expect(calls).toContain('user');
  });
});

// =============================================================================
// Objective 3 — a SINGLE token plane: no new tokenStore consumer, no 2nd JWT plane.
// =============================================================================
describe('single JWT token plane', () => {
  // The only files allowed to import ./tokenStore are the legacy consumers pending
  // migration. A CORRECT migration shrinks this set (to empty once tokenStore.ts is
  // deleted) — still a subset, still green. A NEW importer (dual-read spreading) fails.
  const LEGACY_TOKENSTORE_CONSUMERS = new Set([
    'auth/auth.ts',
    'health/uploadClient.ts',
    'health/liveHrClient.ts',
    'experience/profile/profileServices.ts',
  ]);

  it('no NEW file imports the legacy tokenStore module', () => {
    const importers = PROD_FILES
      .filter((f) => /from\s+['"][^'"]*\/tokenStore['"]/.test(read(f)))
      .map(rel);
    const unexpected = importers.filter((f) => !LEGACY_TOKENSTORE_CONSUMERS.has(f));
    expect(unexpected).toEqual([]);
  });

  // Guards against a second JWT session plane being introduced (the migration's whole
  // point is ONE session Keychain service). watchToken + mmkvKey are separate planes.
  it('every Keychain service string is on the known allowlist', () => {
    const ALLOW = new Set([
      'com.kokonadahealth.jwt',        // legacy — removed by the migration
      'com.kokonadahealth.session',    // unified rotating pair (the one plane)
      'com.kokonadahealth.watchToken', // whr_ device token (separate, must survive)
      'com.kokonadahealth.mmkvKey',    // MMKV encryption key (not a JWT)
    ]);
    const found = new Set<string>();
    for (const f of ALL_FILES) {
      const m = read(f).match(/com\.kokonadahealth\.[A-Za-z]+/g) ?? [];
      m.forEach((s) => found.add(s));
    }
    const rogue = [...found].filter((s) => !ALLOW.has(s));
    expect(rogue).toEqual([]);
  });

  // The authenticated REST + socket surfaces must read ONLY from AuthSession.
  it('apiClient reads its access token from AuthSession, not tokenStore', () => {
    const api = read(path.join(SRC_ROOT, 'net/apiClient.ts'));
    expect(api).toMatch(/authSession/);
    expect(api).not.toMatch(/tokenStore/);
  });
});

// =============================================================================
// Objective 4 — no token leakage: not logged, not on disk, not in a URL.
// =============================================================================
describe('no token leakage', () => {
  const TOKENISH = /\b(token|jwt|bearer|access[_-]?token|whr_)/i;

  it('no console.* statement logs a token', () => {
    const offenders: string[] = [];
    for (const f of PROD_FILES) {
      read(f).split('\n').forEach((line, i) => {
        if (/console\.(log|warn|error|info|debug)\(/.test(line) && TOKENISH.test(line)) {
          offenders.push(`${rel(f)}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it('no token is placed in a URL query string', () => {
    const offenders: string[] = [];
    for (const f of PROD_FILES) {
      read(f).split('\n').forEach((line, i) => {
        if (/[?&](token|jwt|access_token)=/.test(line)) offenders.push(`${rel(f)}:${i + 1}`);
      });
    }
    expect(offenders).toEqual([]);
  });

  // The JWT must live only in the Keychain + memory — never persisted to the cold
  // store. Flag any setItem/AsyncStorage write keyed by a token-ish name.
  it('no token-keyed write to SecureStore / AsyncStorage / MMKV', () => {
    const offenders: string[] = [];
    for (const f of PROD_FILES) {
      read(f).split('\n').forEach((line, i) => {
        if (/\.(setItem|set)\(\s*['"`](token|jwt|session|access|bearer)/i.test(line)) {
          offenders.push(`${rel(f)}:${i + 1}`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
