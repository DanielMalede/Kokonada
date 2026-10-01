'use strict';

// HX-3 T9 (DEC-122, DEC-040; CMP-038, CMP-046) — docs/PRIVACY_DECLARATIONS.md says what the code does
// with YouTube now: nothing. Connecting it is sealed in code, no account holds a token, no YouTube
// data is imported or held, and none goes to Groq or any other service. The store-facing document is
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
    expect(row).toMatch(/No YouTube data is imported or held in this version/);
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
    expect(row).toMatch(/sends YouTube no requests, holds no YouTube data, and sends YouTube data to no other service/);
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
