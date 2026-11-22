'use strict';

// BE-231 — the structural half of "Spotify receives no value derived from medical information"
// (the owner's ruling of 2026-10-28). discoveryHealthEgress.test.js proves the requests the real
// generate path sends; this proves there is no other way to send one. Every Spotify discovery
// request leaves through fetchVibeDiscovery, getRecommendations, searchTracksByGenres,
// searchVibePlaylists or getVibePlaylistTracks in spotify.js, so the references to those names under
// backend/app ARE the discovery surface; fetchVibeDiscovery builds what it sends with
// toDiscoveryQuery; the generation core hands the discovery port a positional second argument,
// `fetchTracks(params, query)`; and the handler's Spotify closure sends `query`, never `params`.
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
  'sockets/biometricHandler.js':          { fetchVibeDiscovery: 1 },
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
    const mutated = inject(real, '          const tagged  = await tagSpotifyDiscovery(', '          await spotify.fetchVibeDiscovery(accessToken, params);\n');
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

  it('the handler\'s Spotify closure takes (params, query), fails closed without a query, and sends only the query', () => {
    const closure = handlerSpotifyClosure(read('sockets/biometricHandler.js'));
    expect(closure).not.toBeNull();
    expect(closure).toMatch(/fetchTracks = async \(params, query\) =>/);
    expect(closure).toMatch(/if \(!query\) return \[\];/);
    const sent = calls(closure, 'spotify.fetchVibeDiscovery');
    expect(sent).toEqual(['spotify.fetchVibeDiscovery(accessToken, query, { limit: DISCOVERY_FETCH_LIMIT })']);
    expect(closure.indexOf('if (!query) return [];')).toBeLessThan(closure.indexOf('spotify.fetchVibeDiscovery('));
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
    expect(calls(handlerSpotifyClosure(sendsParams), 'spotify.fetchVibeDiscovery'))
      .not.toEqual(['spotify.fetchVibeDiscovery(accessToken, query, { limit: DISCOVERY_FETCH_LIMIT })']);
    const noGuard = replaceOnce(handler, 'if (!query) return [];', '');
    expect(handlerSpotifyClosure(noGuard)).not.toMatch(/if \(!query\) return \[\];/);

    const fvd = body(inject(spotify, '  const genreSearch', '  const leaked = { ...params };\n'), 'async function fetchVibeDiscovery(');
    expect(fvd).toMatch(/\.\.\.params/);
  });
});
