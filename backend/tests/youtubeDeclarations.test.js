'use strict';

// HX-3 T9 (DEC-122, DEC-040; CMP-038, CMP-046) — docs/PRIVACY_DECLARATIONS.md says what the code does
// with YouTube now: nothing. Connecting it is sealed in code, no account holds a token, no YouTube
// data is imported, and none goes to Groq or any other service. The store-facing document is
// what the compliance gate reads, so its YouTube statements are pinned against the code here
// (compliance verdicts §4, "T9 test amendment"):
//   • no "YouTube Music", "non-Spotify" or "library artist names" anywhere in the document;
//   • no "38 days" or "7-day grace" in the MusicProfile retention row;
//   • the Groq row's NEVER cell names **YouTube data**;
// and each code symbol the new YouTube statements cite as their evidence exists where cited.
//
// Pure filesystem parsing — no Mongo, no Redis, no network.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '../..');
const DOC = path.join(REPO_ROOT, 'docs/PRIVACY_DECLARATIONS.md');
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
const doc = () => fs.readFileSync(DOC, 'utf8');

/** The `## <title>` section body, up to the next `## ` heading. */
function section(markdown, title) {
  const start = markdown.indexOf(`## ${title}`);
  if (start === -1) return null;
  const rest = markdown.slice(start + 3);
  const next = rest.indexOf('\n## ');
  return next === -1 ? rest : rest.slice(0, next);
}

/** The text a reader sees: HTML comments (the verified notes) removed. */
const visible = (line) => line.replace(/<!--[\s\S]*?-->/g, '');

/** Each line naming YouTube in any case, keyed by its first cell (a table row) or opening words. */
function youtubeLines(markdown) {
  return markdown.split('\n')
    .filter((l) => /youtube/i.test(l))
    .map((l) => (l.startsWith('| ') ? l.slice(0, l.indexOf(' | ', 2)) : l.slice(0, 60)));
}
// HX-3 round 1 (after the regulatory edits E1–E4): the five lines that may name YouTube.
const YOUTUBE_LINES = [
  '| 3rd-party OAuth tokens (Spotify, wearable)',
  '| Music profile & listening-derived taste',
  '| **Groq** (`api.groq.com`, US-hosted inference)',
  '| **YouTube** (music provider)',
  '| Music profile & taste (`MusicProfile`)',
];

/** A table row's cells, split on the column pipes (no cell here contains a bare pipe). */
const cells = (row) => row.split(' | ').map((c) => c.replace(/^\|\s*|\s*\|$/g, '').trim());

describe('the privacy declarations say YouTube is sealed, and nothing more (HX-3 T9)', () => {
  it('no "YouTube Music", "non-Spotify" or "library artist names" anywhere in the document', () => {
    const hits = doc().split('\n')
      .map((line, i) => ({ line: i + 1, text: line }))
      .filter(({ text }) => /YouTube Music|non-Spotify|library artist names/.test(text))
      .map(({ line, text }) => `${line}: ${text.slice(0, 120)}`);
    expect(hits).toEqual([]);
  });

  it('the MusicProfile retention row carries no "38 days" and no "7-day grace"', () => {
    const retention = section(doc(), 'Retention');
    expect(retention).toBeTruthy();
    const row = retention.split('\n').find((l) => l.startsWith('|') && l.includes('`MusicProfile`'));
    expect(row).toBeTruthy();
    expect(row).not.toMatch(/38 days/);
    expect(row).not.toMatch(/7-day grace/);
    expect(row).toMatch(/No YouTube data is imported in this version \(connecting YouTube is sealed in code, DEC-122\)\./);
    expect(visible(row)).not.toMatch(/\bheld\b/);
  });

  it("the Groq row's NEVER cell names **YouTube data**, and its RECEIVES cell names no YouTube data", () => {
    const row = doc().split('\n').find((l) => l.startsWith('| **Groq**'));
    expect(row).toBeTruthy();
    const [, , receives, never] = cells(row);
    expect(never).toContain('**YouTube data**');
    expect(receives).not.toMatch(/YouTube/);
  });

  it('YouTube has its own provider row: not connected, receives nothing, sent to no one', () => {
    const subProcessors = section(doc(), 'Sub-processors (who touches the data, and what they receive)');
    expect(subProcessors).toBeTruthy();
    const row = subProcessors.split('\n').find((l) => l.startsWith('| **YouTube**'));
    expect(row).toBeTruthy();
    expect(row).toMatch(/Not connected in this version: connecting it is sealed in code \(DEC-122\)/);
    // HX-3 round 1, regulatory E1 (BLOCK): the row says what the code does — it IMPORTS nothing — not
    // what is stored, which rests on evidence (DAN-046 P0, P1, P0b) kept in the verified comment.
    expect(row).toMatch(/sends YouTube no requests, imports no YouTube data, and sends YouTube data to no other service/);
    expect(visible(row)).not.toMatch(/holds no YouTube data/);
    expect(row).toContain('Publish no "holds no YouTube data" sentence before P1 and P0b are recorded. -->');
  });

  it('the OAuth-token row dates its zero-holder evidence (regulatory E2)', () => {
    const row = doc().split('\n').find((l) => l.startsWith('| 3rd-party OAuth tokens'));
    expect(row).toContain('zero holders: DAN-046 P0, 2026-10-01T14:05Z, before the deploy; P1 after the deploy owed -->');
  });

  it('the Groq row names the catalogue flow precisely: no Kokonada user library, only while the ingest is on (regulatory E3)', () => {
    const row = doc().split('\n').find((l) => l.startsWith('| **Groq**'));
    const [, , receives] = cells(row);
    expect(receives).toContain("artist names from the open AcousticBrainz data (CC0), which come from no Kokonada user's library, sent only while the catalogue ingest is switched on (GLOBAL_SEED_INGEST_ENABLED).");
    expect(row).toContain("runOnce's only caller is backend/app/workers/globalSeedIngest.worker.js (reads GLOBAL_AB_DUMP_PATH, built by backend/scripts/prepare-wave1-dump.js from the AcousticBrainz dumps; dark unless GLOBAL_SEED_INGEST_ENABLED=true; production value unrecorded);");
    expect(row).toContain('biometricHandler.js withoutYoutube; shared caches hold no youtube:-keyed rows: DAN-046 P1 /health/youtube-leak (owed) — the caption prompt (services/discovery/captionService.js) carries the features of discovery tracks drawn from them -->');
    // The cited files and switches are real.
    expect(read('backend/app/workers/globalSeedIngest.worker.js')).toMatch(/process\.env\.GLOBAL_SEED_INGEST_ENABLED === 'true'/);
    expect(read('backend/app/workers/globalSeedIngest.worker.js')).toMatch(/process\.env\.GLOBAL_AB_DUMP_PATH/);
    expect(fs.existsSync(path.join(REPO_ROOT, 'backend/scripts/prepare-wave1-dump.js'))).toBe(true);
    expect(fs.existsSync(path.join(REPO_ROOT, 'backend/app/services/discovery/captionService.js'))).toBe(true);
  });

  it('the Groq standing condition names the catalogue artist names it transmits (regulatory E4)', () => {
    expect(doc().split('\n')).toContain('> (and, for catalogue genre enrichment, public catalogue artist names) are transmitted to Groq, a **Data');
  });

  // Compliance NF-B4: a plain "YouTube" coming back into a statement — "(Spotify/YouTube/Garmin)" in the
  // Play sharing answer, say — is caught by none of the phrase pins above. So every line naming YouTube,
  // in any case, is allowlisted, by the line's first cell (a table row) or its opening words.
  it('only the allowlisted lines name YouTube (compliance NF-B4)', () => {
    expect(youtubeLines(doc())).toEqual(YOUTUBE_LINES);
  });

  it('"(Spotify/YouTube/Garmin)" put back into the Play sharing answer is caught (NF-B4, planted)', () => {
    const d = doc();
    const now = "(Spotify/Garmin) **at the user's direction**";
    expect(d).toContain(now);
    const regressed = d.replace(now, "(Spotify/YouTube/Garmin) **at the user's direction**");
    expect(youtubeLines(regressed)).not.toEqual(YOUTUBE_LINES);
    expect(youtubeLines(regressed)).toContain('- **Data collected & shared:** Collected: **yes.** **Shared ');
  });

  it('every code symbol the YouTube statements cite as evidence exists where cited', () => {
    const d = doc();
    // The seal itself (rows :43 and :74).
    expect(d).toContain('backend/app/config/youtubeSeal.js');
    expect(read('backend/app/config/youtubeSeal.js')).toMatch(/YOUTUBE_CONNECT_ENABLED:\s*false/);
    expect(read('backend/app/config/youtubeSeal.js')).toMatch(/YOUTUBE_EGRESS_ENABLED:\s*false/);
    // The Groq row's YouTube evidence: the estimator choke, the empty backfill allowlist, the view.
    const groq = d.split('\n').find((l) => l.startsWith('| **Groq**'));
    for (const cite of ['featureService.js _dropRestricted', 'LLM_BACKFILL_PROVIDERS', 'biometricHandler.js withoutYoutube']) {
      expect(groq).toContain(cite);
    }
    expect(read('backend/app/services/features/featureService.js')).toMatch(/function _dropRestricted\b/);
    expect(read('backend/app/services/musicProfileService.js')).toMatch(/const LLM_BACKFILL_PROVIDERS = YOUTUBE_EGRESS_ENABLED \? new Set\(\['youtube_music'\]\) : new Set\(\);/);
    expect(read('backend/app/sockets/biometricHandler.js')).toMatch(/withoutYoutube\(await MusicProfile\.findOne\(\{ userId \}\)\.lean\(\)\)/);
  });
});
