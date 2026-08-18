'use strict';

// Wave-4 reflection close-out marker — `logs/wave4/last-reflect.txt`.
//
// Mission §2 step 4 latches the recurring-reflection trigger on this one file: "read
// logs/wave4/last-reflect.txt ... If it is missing, or >= REFLECT_INTERVAL_HOURS have passed
// since it, this session is a REFLECTION session". §2.5 R7 is what clears it again.
//
// W4-D01: nothing but a session's voluntary compliance with R7 ever wrote the file, so a
// reflection that was killed, timed out or simply forgot the last step left the trigger latched
// ON — every later session would reflect again and the queue could never advance. This module is
// the ONE implementation of the marker's format and staleness rule; both the loop
// (scripts/run-mission.ps1, which stamps it as a backstop) and the session (R7) go through it, so
// the answer to "is a reflection due?" is no longer re-derived by hand once per session.
//
// The rules here are pure — `now` is always a parameter (mission §0.4 S9) — and every parse
// failure degrades toward "reflect again", never toward silence.
//
// CLI:
//   node scripts/wave4/reflect-marker.js stamp [--sha <sha>] [--at <iso>] [--root <dir>]
//   node scripts/wave4/reflect-marker.js check [--now <iso>] [--interval <hours>] [--root <dir>]

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const MARKER_RELPATH = 'logs/wave4/last-reflect.txt';
const DEFAULT_INTERVAL_HOURS = 4;          // STATE: reflectIntervalHours
const FUTURE_SKEW_MS = 5 * 60 * 1000;      // tolerated clock skew before a marker is called invalid

// Strict ISO-8601, so prose like "no reflection has run yet" can never be coerced into a date the
// way free-form Date parsing would. A naive timestamp (no zone) is read as UTC — the marker is
// specified as UTC and a hand-edit that drops the Z should not silently shift by the box's offset.
const ISO_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|z|[+-]\d{2}:?\d{2})?$/;
const SHA_RE = /^[0-9a-f]{7,40}$/i;

function markerPath(root) {
  return path.join(root, ...MARKER_RELPATH.split('/'));
}

function toIsoZ(date) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function formatMarker({ at, sha } = {}) {
  const lines = [toIsoZ(at instanceof Date ? at : new Date(at))];
  if (sha) lines.push(String(sha).trim());
  return `${lines.join('\n')}\n`;
}

function parseMarker(text) {
  const empty = { at: null, sha: null };
  if (typeof text !== 'string') return empty;

  // Comment lines are allowed so a human can annotate the file without breaking the trigger.
  const tokens = text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join(' ')
    .split(/\s+/)
    .filter(Boolean);

  let at = null;
  let sha = null;
  for (const token of tokens) {
    if (!at && ISO_RE.test(token)) {
      const naive = !/(?:Z|z|[+-]\d{2}:?\d{2})$/.test(token);
      const parsed = new Date(naive ? `${token.replace(' ', 'T')}Z` : token.replace(' ', 'T'));
      if (!Number.isNaN(parsed.getTime())) { at = parsed; continue; }
    }
    if (!sha && SHA_RE.test(token)) sha = token;
  }
  return { at, sha };
}

// → { due, reason, ageHours }. reason ∈ missing | unparseable | future | stale | fresh.
function reflectionDue({ text, now, intervalHours = DEFAULT_INTERVAL_HOURS } = {}) {
  const at = (now instanceof Date ? now : new Date(now)).getTime();

  if (text === null || text === undefined || String(text).trim() === '') {
    return { due: true, reason: 'missing', ageHours: null };
  }

  const marker = parseMarker(text);
  if (!marker.at) return { due: true, reason: 'unparseable', ageHours: null };

  const deltaMs = at - marker.at.getTime();
  const ageHours = deltaMs / 3600000;

  // A marker dated in the future would otherwise suppress reflections indefinitely — the same
  // trap mission §0.4 S6 pins for biometric recordedAt. Reject it rather than trust it.
  if (-deltaMs > FUTURE_SKEW_MS) return { due: true, reason: 'future', ageHours };
  if (deltaMs >= intervalHours * 3600000) return { due: true, reason: 'stale', ageHours };
  return { due: false, reason: 'fresh', ageHours };
}

function headSha(root) {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null; // no git, detached tooling, fresh export — the timestamp alone still clears the trigger
  }
}

function readMarker(root) {
  try {
    return fs.readFileSync(markerPath(root), 'utf8');
  } catch {
    return null;
  }
}

function stampMarker({ root = process.cwd(), at = new Date(), sha } = {}) {
  const file = markerPath(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, formatMarker({ at, sha: sha === undefined ? headSha(root) : sha }), 'utf8');
  return file;
}

module.exports = {
  MARKER_RELPATH,
  DEFAULT_INTERVAL_HOURS,
  FUTURE_SKEW_MS,
  markerPath,
  formatMarker,
  parseMarker,
  reflectionDue,
  readMarker,
  stampMarker,
};

// --- CLI ------------------------------------------------------------------------------------
if (require.main === module) {
  const argv = process.argv.slice(2);
  const flag = (name) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const root = flag('root') || process.cwd();

  switch (argv[0]) {
    case 'stamp': {
      const atFlag = flag('at');
      const file = stampMarker({ root, at: atFlag ? new Date(atFlag) : new Date(), sha: flag('sha') });
      process.stdout.write(`stamped ${file}\n`);
      break;
    }
    case 'check': {
      const nowFlag = flag('now');
      const verdict = reflectionDue({
        text: readMarker(root),
        now: nowFlag ? new Date(nowFlag) : new Date(),
        intervalHours: Number(flag('interval') || DEFAULT_INTERVAL_HOURS),
      });
      const age = verdict.ageHours === null ? '' : ` (${verdict.ageHours.toFixed(2)}h old)`;
      process.stdout.write(`${verdict.due ? 'DUE' : 'NOT-DUE'} ${verdict.reason}${age}\n`);
      break;
    }
    default:
      process.stderr.write('usage: reflect-marker.js <stamp|check> [--sha s] [--at iso] [--now iso] [--interval h] [--root dir]\n');
      process.exit(2);
  }
}
