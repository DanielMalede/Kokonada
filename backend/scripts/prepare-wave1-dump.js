'use strict';

// prepare-wave1-dump.js — normalize the CC0 AcousticBrainz dumps into the NDJSON that the Wave-1
// global-seed ingestion consumes (acousticBrainzDump.readBatch → acousticBrainzFeatures.mapRecord).
//
// AcousticBrainz ships TWO tar dumps: HIGH-LEVEL (mood models, danceability) and LOW-LEVEL
// (rhythm.bpm, lowlevel.average_loudness). Both carry metadata.tags (MBID/artist/title). This tool
// STREAMS both (never extracting millions of files to disk), joins by MusicBrainz recording id, and
// emits one merged record per line to `wave1_seed_dump.ndjson` — the exact shape mapRecord reads.
//
// Streaming deps: `tar-stream` (tar parsing) + Node's BUILT-IN zstd/gzip (node:zlib on Node ≥22.15 —
// this backend is Node 24, so no zstd-codec dependency is needed). `.bz2` inputs need unbzip2-stream
// (optional; the legacy AB dumps were .bz2 — prefer the .zst re-publish, or convert first).
//
// Usage:
//   node scripts/prepare-wave1-dump.js --highlevel <hl.tar.zst> --lowlevel <ll.tar.zst> \
//        [--out wave1_seed_dump.ndjson] [--limit 5000] [--all]
// Memory is bounded by --limit (default 5000 distinct MBIDs held from the high-level pass).

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const fs = require('fs');
const zlib = require('node:zlib');

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const first = (v) => (Array.isArray(v) ? v[0] : v);

// --- pure, testable core ---------------------------------------------------

// MBID from metadata.tags (primary) or the tar entry filename (fallback).
function extractMbid(rec, entryName = '') {
  const fromTags = first(rec?.metadata?.tags?.musicbrainz_recordingid);
  if (typeof fromTags === 'string' && UUID_RE.test(fromTags)) return fromTags.toLowerCase();
  const m = String(entryName).match(UUID_RE);
  return m ? m[0].toLowerCase() : null;
}

// Merge a high-level record (moods) + a low-level record (rhythm/loudness) into the reader shape.
// Tags prefer the high-level side; artist/title fall back to the low-level side.
function buildSeedRecord({ mbid, highlevelRec = {}, lowlevelRec = {} }) {
  const hlTags = highlevelRec?.metadata?.tags || {};
  const llTags = lowlevelRec?.metadata?.tags || {};
  const tags = {
    musicbrainz_recordingid: [mbid],
    artist: hlTags.artist ?? llTags.artist,
    title: hlTags.title ?? llTags.title,
  };
  return {
    metadata: { tags },
    rhythm: { bpm: lowlevelRec?.rhythm?.bpm },
    lowlevel: { average_loudness: lowlevelRec?.lowlevel?.average_loudness },
    highlevel: highlevelRec?.highlevel || {},
  };
}

// A seed is worth emitting only if it can become a servable corpus row: canonical id + title + artist
// (so it can be resolved at play time) AND at least one usable feature signal (bpm or any mood model).
function isServable(seed) {
  const mbid = first(seed?.metadata?.tags?.musicbrainz_recordingid);
  const artist = first(seed?.metadata?.tags?.artist);
  const title = first(seed?.metadata?.tags?.title);
  if (!mbid || !artist || !title) return false;
  const hasBpm = Number.isFinite(Number(seed?.rhythm?.bpm));
  const hasMood = seed?.highlevel && Object.keys(seed.highlevel).length > 0;
  return Boolean(hasBpm || hasMood);
}

// --- streaming ------------------------------------------------------------

function decompressorFor(filePath) {
  if (/\.zst$/i.test(filePath)) return zlib.createZstdDecompress();
  if (/\.(gz|tgz)$/i.test(filePath)) return zlib.createGunzip();
  if (/\.bz2$/i.test(filePath)) {
    try { return require('unbzip2-stream')(); }
    catch { throw new Error('.bz2 input needs unbzip2-stream (`npm i -D unbzip2-stream`) or convert the dump to .zst first'); }
  }
  return null; // plain .tar
}

// Stream a (optionally compressed) tar dump, invoking onEntry(record, name) per JSON member. If
// onEntry returns 'STOP', reading halts early (bounded slice). Malformed members are skipped.
function streamTar(filePath, onEntry) {
  return new Promise((resolve, reject) => {
    const tar = require('tar-stream');
    const extract = tar.extract();
    const src = fs.createReadStream(filePath);
    let stopped = false;
    const stop = () => { if (stopped) return; stopped = true; try { src.destroy(); } catch { /* noop */ } try { extract.destroy(); } catch { /* noop */ } resolve(); };

    extract.on('entry', (header, stream, next) => {
      if (stopped || header.type !== 'file' || !/\.json$/i.test(header.name)) { stream.resume(); return next(); }
      const chunks = [];
      stream.on('data', (c) => chunks.push(c));
      stream.on('error', () => next());
      stream.on('end', async () => {
        if (stopped) return next();
        let rec = null;
        try { rec = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { rec = null; }
        let signal;
        if (rec) { try { signal = await onEntry(rec, header.name); } catch { /* skip bad member */ } }
        if (signal === 'STOP') return stop();
        next();
      });
    });
    extract.on('finish', () => { if (!stopped) resolve(); });
    extract.on('error', (e) => { if (!stopped) reject(e); });
    src.on('error', (e) => { if (!stopped) reject(e); });

    const dec = decompressorFor(filePath);
    if (dec) { dec.on('error', (e) => { if (!stopped) reject(e); }); src.pipe(dec).pipe(extract); }
    else { src.pipe(extract); }
  });
}

async function run({ highlevel, lowlevel, out, limit = 5000, requireFeatures = true }) {
  // Pass 1: hold up to `limit` distinct MBIDs' high-level data (memory bound).
  const hlByMbid = new Map();
  await streamTar(highlevel, (rec, name) => {
    const mbid = extractMbid(rec, name);
    if (!mbid || hlByMbid.has(mbid) || !rec.highlevel) return;
    hlByMbid.set(mbid, rec);
    if (hlByMbid.size >= limit) return 'STOP';
  });

  // Pass 2: stream low-level, join by MBID, emit merged NDJSON for the held set.
  const outStream = fs.createWriteStream(out);
  const emitted = new Set();
  let scanned = 0;
  await streamTar(lowlevel, (rec, name) => {
    scanned++;
    const mbid = extractMbid(rec, name);
    if (!mbid || !hlByMbid.has(mbid) || emitted.has(mbid)) return;
    const seed = buildSeedRecord({ mbid, highlevelRec: hlByMbid.get(mbid), lowlevelRec: rec });
    if (requireFeatures && !isServable(seed)) return;
    outStream.write(JSON.stringify(seed) + '\n');
    emitted.add(mbid);
    if (emitted.size >= hlByMbid.size) return 'STOP'; // every held MBID matched — done
  });
  await new Promise((res, rej) => outStream.end((e) => (e ? rej(e) : res())));

  return { highlevelHeld: hlByMbid.size, lowlevelScanned: scanned, emitted: emitted.size };
}

function parseArgs(argv = process.argv.slice(2)) {
  const a = { out: process.env.GLOBAL_AB_DUMP_PATH || 'wave1_seed_dump.ndjson', limit: 5000, requireFeatures: true };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--highlevel' && argv[i + 1]) a.highlevel = argv[++i];
    else if (argv[i] === '--lowlevel' && argv[i + 1]) a.lowlevel = argv[++i];
    else if (argv[i] === '--out' && argv[i + 1]) a.out = argv[++i];
    else if (argv[i] === '--limit' && argv[i + 1]) a.limit = Math.max(1, parseInt(argv[++i], 10) || 5000);
    else if (argv[i] === '--all') a.limit = Infinity;
    else if (argv[i] === '--no-require-features') a.requireFeatures = false;
  }
  return a;
}

async function main() {
  const args = parseArgs();
  if (!args.highlevel || !args.lowlevel) {
    console.error('Usage: node scripts/prepare-wave1-dump.js --highlevel <hl.tar.zst> --lowlevel <ll.tar.zst> [--out wave1_seed_dump.ndjson] [--limit 5000] [--all]');
    process.exit(2);
  }
  console.log(`[prepare-wave1-dump] highlevel=${args.highlevel} lowlevel=${args.lowlevel} → ${args.out} (limit=${args.limit})`);
  const t0 = Date.now();
  const res = await run(args);
  console.log(`[prepare-wave1-dump] done in ${((Date.now() - t0) / 1000).toFixed(1)}s — held=${res.highlevelHeld} scanned=${res.lowlevelScanned} emitted=${res.emitted} → ${args.out}`);
  console.log('[prepare-wave1-dump] set GLOBAL_AB_DUMP_PATH to the output, then enable GLOBAL_SEED_INGEST_ENABLED (see docs/runbooks/global-seed-ingestion-wave1.md).');
}

if (require.main === module) {
  main().catch((e) => { console.error('[prepare-wave1-dump] fatal:', e.message); process.exit(1); });
}

module.exports = { extractMbid, buildSeedRecord, isServable, decompressorFor, run, parseArgs };
