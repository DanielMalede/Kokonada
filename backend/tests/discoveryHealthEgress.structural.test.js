'use strict';

// BE-231 — the structural half of "Spotify receives no value derived from medical information"
// (the owner's ruling of 2026-10-28). discoveryHealthEgress.test.js proves the requests the real
// generate path sends; this proves there is no other way to send one. Every Spotify discovery
// request leaves through fetchVibeDiscovery, getRecommendations, searchTracksByGenres,
// searchVibePlaylists or getVibePlaylistTracks in spotify.js, so the references to those names under
// backend/app ARE the discovery surface; fetchVibeDiscovery builds what it sends with
// toDiscoveryQuery; the generation core hands the discovery port a positional second argument,
// `fetchTracks(params, query)`; and the handler's one send (fetchSpotifyDiscovery) sends `query`,
// never `params`. Since BE-231 RA-1 only the user-driven paths reach that send — the emotion port
// and the session-open refresh — and the heart-rate port reads the per-user cache only.
//
// Identifier references are counted with comments stripped, so a comment can neither hide a
// reference nor invent one. Each check is also run on a mutated copy of a real file, so it cannot
// pass vacuously.

const fs = require('fs');
const path = require('path');

const APP = path.join(__dirname, '../app');
const NAMES = [
  'fetchVibeDiscovery', 'getRecommendations', 'searchTracksByGenres', 'searchVibePlaylists',
  'getVibePlaylistTracks', 'toDiscoveryQuery', 'bioDiscoveryQuery',
];

// file (relative to backend/app) → name → number of identifier references: definitions, imports,
// exports and calls alike.
const ALLOWED = {
  'services/spotify.js': {
    getRecommendations: 3, searchTracksByGenres: 2, searchVibePlaylists: 3,
    getVibePlaylistTracks: 3, fetchVibeDiscovery: 2, toDiscoveryQuery: 2,
  },
  'services/discovery/discoveryQuery.js': { toDiscoveryQuery: 3, bioDiscoveryQuery: 2 },
  'services/geminiEngine.js':             { toDiscoveryQuery: 2, bioDiscoveryQuery: 2 },
  // BE-231 RA-1: the one send sits in fetchSpotifyDiscovery; the session-open refresh builds the
  // heart branch's old query (the first two top genres) itself, so the heart branch needs none.
  'sockets/biometricHandler.js':          { fetchVibeDiscovery: 1, bioDiscoveryQuery: 2 },
};

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
}

function references(src) {
  const code = stripComments(src);
  const out = {};
  for (const name of NAMES) {
    const n = (code.match(new RegExp(`(?<![\\w$])${name}(?![\\w$])`, 'g')) || []).length;
    if (n) out[name] = n;
  }
  return out;
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return /\.(c|m)?js$/.test(e.name) ? [p] : [];
  });
}

function scan(fn) {
  const found = {};
  for (const file of walk(APP)) {
    const hit = fn(fs.readFileSync(file, 'utf8'));
    if (Array.isArray(hit) ? hit.length : Object.keys(hit).length) found[path.relative(APP, file).split(path.sep).join('/')] = hit;
  }
  return found;
}

const read = (rel) => fs.readFileSync(path.join(APP, rel), 'utf8');
function inject(src, anchor, text) {
  const at = src.indexOf(anchor);
  if (at < 0) throw new Error(`anchor not found: ${anchor}`);
  return src.slice(0, at) + text + src.slice(at);
}
function replaceOnce(src, from, to) {
  const at = src.indexOf(from);
  if (at < 0) throw new Error(`anchor not found: ${from}`);
  return src.slice(0, at) + to + src.slice(at + from.length);
}

// A function's body by its declaration, comments stripped: from the declaration to the first line
// that is a lone closing brace at column 0.
function body(src, decl) {
  const code = stripComments(src);
  const at = code.indexOf(decl);
  if (at < 0) return null;
  return code.slice(at, code.indexOf('\n}\n', at) + 2);
}

// Every call of `callee(` in the code, as its full text with balanced parentheses.
function calls(src, callee) {
  const code = stripComments(src);
  const out = [];
  const re = new RegExp(`(?<![\\w$.])${callee}\\(`, 'g');
  let m;
  while ((m = re.exec(code))) {
    let depth = 0;
    let i = m.index + callee.length;
    for (; i < code.length; i++) {
      if (code[i] === '(') depth++;
      else if (code[i] === ')' && --depth === 0) break;
    }
    out.push(code.slice(m.index, i + 1));
  }
  return out;
}

// The guarded properties, as functions, so the same check runs on the real file and on a mutated copy.
const TARGET_KEY = /(?<![\w$])(?:target|min|max)_(?:tempo|bpm|energy|valence|acousticness|danceability|loudness)(?![\w$])/;
const spotifyTargets = (src) => (stripComments(src).match(new RegExp(TARGET_KEY.source, 'g')) || []);
const engineFetchCalls = (src) => calls(src, 'fetchTracks');
function handlerSpotifyClosure(src) {
  const code = stripComments(src);
  const at = code.indexOf("if (provider === 'spotify') {");
  if (at < 0) return null;
  return code.slice(at, code.indexOf('} else {', at));
}
// BE-231 RA-1: the handler's discovery ports and the one function that sends, by declaration.
const HANDLER_FN = {
  send:    'async function fetchSpotifyDiscovery(',
  emotion: 'function emotionDiscoveryPort(',
  heart:   'function heartDiscoveryPort(',
  open:    'async function refreshDiscoveryOnSessionOpen(',
};
const handlerFn = (src, which) => body(src, HANDLER_FN[which]);
// The names that reach Spotify, or write the cache, from inside the handler.
const SENDS = /(?<![\w$])(?:fetchVibeDiscovery|fetchSpotifyDiscovery|getRecommendations|searchTracksByGenres|searchVibePlaylists|getVibePlaylistTracks|tagSpotifyDiscovery|getArtistsGenres|writeDiscoveryCandidates|getValidToken|refreshDiscoveryOnSessionOpen)(?![\w$])/;
// The handler functions above that call `callee(`, one entry per call, the callee's own declaration excluded.
function callersOf(src, callee) {
  const out = [];
  for (const [which, decl] of Object.entries(HANDLER_FN)) {
    const fn = body(src, decl);
    if (fn && !decl.includes(`function ${callee}(`)) out.push(...calls(fn, callee).map(() => which));
  }
  return out.sort();
}
const totalCalls = (src, callee) => calls(src, callee).length;

describe('the Spotify discovery surface is exactly the allow-list', () => {
  it('every reference to the discovery functions and the query builders under backend/app is pinned', () => {
    expect(scan(references)).toEqual(ALLOWED);
  });

  it('the /recommendations path appears only in spotify.js', () => {
    expect(scan((src) => (stripComments(src).includes('/recommendations') ? ['/recommendations'] : []))).toEqual({
      'services/spotify.js': ['/recommendations'],
    });
  });

  it('not vacuous: a second fetchVibeDiscovery call in the real handler changes its count', () => {
    const real = read('sockets/biometricHandler.js');
    const mutated = inject(real, '  const tagged = await tagSpotifyDiscovery(', '  await spotify.fetchVibeDiscovery(accessToken, params);\n');
    expect(references(real)).toEqual(ALLOWED['sockets/biometricHandler.js']);
    expect(references(mutated)).not.toEqual(ALLOWED['sockets/biometricHandler.js']);
  });

  it('not vacuous: a commented-out call is not counted', () => {
    const real = read('sockets/biometricHandler.js');
    expect(references(`${real}\n// spotify.getRecommendations(token, params)\n/* searchTracksByGenres(t, g) */\n`)).toEqual(references(real));
  });
});

describe('no numeric audio target is sent, and the query is the only input', () => {
  it('spotify.js names no target_*, min_* or max_* audio key in code', () => {
    expect(spotifyTargets(read('services/spotify.js'))).toEqual([]);
  });

  it('fetchVibeDiscovery builds what it sends with toDiscoveryQuery', () => {
    const fn = body(read('services/spotify.js'), 'async function fetchVibeDiscovery(');
    expect(fn).not.toBeNull();
    expect(fn).toMatch(/toDiscoveryQuery\(/);
    expect(fn).not.toMatch(/\.\.\.params/);
  });

  it('the generation core calls the discovery port only as fetchTracks(params, query)', () => {
    const found = engineFetchCalls(read('services/geminiEngine.js'));
    expect(found).toEqual(['fetchTracks(params, query)', 'fetchTracks(params, query)']);
  });

  it('the handler\'s Spotify block wires the emotion port on the emotion branch and the cache-only port on the heart-rate branch', () => {
    const closure = handlerSpotifyClosure(read('sockets/biometricHandler.js'));
    expect(closure).not.toBeNull();
    expect(closure).toMatch(/fetchTracks = useEmotion\s*\?\s*emotionDiscoveryPort\(/);
    expect(closure).toMatch(/:\s*heartDiscoveryPort\(\{ userId, musicProfile, bandTargets \}\)/);
    expect(closure).not.toMatch(/fetchVibeDiscovery|fetchSpotifyDiscovery/);
  });

  it('the one send is fetchSpotifyDiscovery, and it sends only the query', () => {
    const send = handlerFn(read('sockets/biometricHandler.js'), 'send');
    expect(send).not.toBeNull();
    expect(calls(send, 'spotify.fetchVibeDiscovery')).toEqual(['spotify.fetchVibeDiscovery(accessToken, query, { limit: DISCOVERY_FETCH_LIMIT })']);
  });

  it('the emotion port takes (params, query), fails closed without a query, then sends it and refreshes the cache', () => {
    const port = handlerFn(read('sockets/biometricHandler.js'), 'emotion');
    expect(port).not.toBeNull();
    expect(port).toMatch(/return async \(params, query\) =>/);
    expect(port).toMatch(/if \(!query\) return \[\];/);
    expect(calls(port, 'fetchSpotifyDiscovery')).toEqual(['fetchSpotifyDiscovery(accessToken, musicProfile, query)']);
    expect(port.indexOf('if (!query) return [];')).toBeLessThan(port.indexOf('fetchSpotifyDiscovery('));
    expect(calls(port, 'writeDiscoveryCandidates')).toEqual(['writeDiscoveryCandidates(userId, onTaste)']);
  });

  it('RA-1: the heart-rate port reads the cache, and nothing in it can reach Spotify or write the cache', () => {
    const port = handlerFn(read('sockets/biometricHandler.js'), 'heart');
    expect(port).not.toBeNull();
    expect(port).not.toMatch(SENDS);
    expect(port).not.toMatch(/\bspotify\.|accessToken|query/);
    expect(calls(port, 'readDiscoveryCandidates')).toEqual(['readDiscoveryCandidates(userId)']);
  });

  it('RA-1: only the user-driven paths send or refresh — the emotion port and the session-open refresh, called from live_mode', () => {
    const handler = read('sockets/biometricHandler.js');
    expect(callersOf(handler, 'fetchSpotifyDiscovery')).toEqual(['emotion', 'open']);
    expect(totalCalls(handler, 'fetchSpotifyDiscovery')).toBe(3); // its declaration and those two calls
    expect(callersOf(handler, 'writeDiscoveryCandidates')).toEqual(['emotion', 'open']);
    expect(totalCalls(handler, 'writeDiscoveryCandidates')).toBe(2);
    expect(callersOf(handler, 'readDiscoveryCandidates')).toEqual(['heart']);
    expect(totalCalls(handler, 'readDiscoveryCandidates')).toBe(1);
    const open = handlerFn(handler, 'open');
    expect(open).not.toBeNull();
    expect(calls(open, 'bioDiscoveryQuery')).toEqual(['bioDiscoveryQuery(musicProfile)']);
    const code = stripComments(handler);
    const liveMode = code.slice(code.indexOf("socket.on('live_mode',"), code.indexOf("socket.on('emotion_update',"));
    expect(calls(liveMode, 'refreshDiscoveryOnSessionOpen')).toHaveLength(1);
    expect(totalCalls(handler, 'refreshDiscoveryOnSessionOpen')).toBe(2); // its declaration and that call
  });

  it('not vacuous: each check fails on a mutated copy of the real file', () => {
    const spotify = read('services/spotify.js');
    expect(spotifyTargets(inject(spotify, '          seed_genres:', '          target_tempo: 1,\n'))).toEqual(['target_tempo']);

    const engine = read('services/geminiEngine.js');
    expect(engineFetchCalls(replaceOnce(engine, 'tracks: await fetchTracks(params, query)', 'tracks: await fetchTracks(params)')))
      .not.toEqual(['fetchTracks(params, query)', 'fetchTracks(params, query)']);
    expect(engineFetchCalls(inject(engine, 'module.exports = {', 'function leak(p) { return fetchTracks(p, p); }\n')))
      .toHaveLength(3);

    const handler = read('sockets/biometricHandler.js');
    const sendsParams = replaceOnce(handler, 'spotify.fetchVibeDiscovery(accessToken, query,', 'spotify.fetchVibeDiscovery(accessToken, params,');
    expect(calls(handlerFn(sendsParams, 'send'), 'spotify.fetchVibeDiscovery'))
      .not.toEqual(['spotify.fetchVibeDiscovery(accessToken, query, { limit: DISCOVERY_FETCH_LIMIT })']);
    const noGuard = replaceOnce(handler, 'if (!query) return [];', '');
    expect(handlerFn(noGuard, 'emotion')).not.toMatch(/if \(!query\) return \[\];/);

    // RA-1: a heart port that sends, refreshes or writes is caught, and so is a heart branch wired to the emotion port.
    const heartAnchor = '    return readDiscoveryCandidates(userId);';
    for (const leak of [
      '    await fetchSpotifyDiscovery(accessToken, musicProfile, query);\n',
      '    await writeDiscoveryCandidates(userId, []);\n',
      '    await spotify.fetchVibeDiscovery(token, q);\n',
    ]) {
      expect(handlerFn(inject(handler, heartAnchor, leak), 'heart')).toMatch(SENDS);
    }
    const heartSends = inject(handler, heartAnchor, '    await fetchSpotifyDiscovery(accessToken, musicProfile, query);\n');
    expect(callersOf(heartSends, 'fetchSpotifyDiscovery')).not.toEqual(['emotion', 'open']);
    const wiredWrong = replaceOnce(handler, ': heartDiscoveryPort({ userId, musicProfile, bandTargets })', ': emotionDiscoveryPort({ userId, accessToken: spotifyToken, musicProfile, bandTargets })');
    expect(handlerSpotifyClosure(wiredWrong)).not.toMatch(/:\s*heartDiscoveryPort\(\{ userId, musicProfile, bandTargets \}\)/);

    const fvd = body(inject(spotify, '  const genreSearch', '  const leaked = { ...params };\n'), 'async function fetchVibeDiscovery(');
    expect(fvd).toMatch(/\.\.\.params/);
  });
});
