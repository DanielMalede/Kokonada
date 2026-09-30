'use strict';

// Decommissioned-model guard. Groq shut down the two models below for free and developer tiers on
// 2026-08-16, and both were our defaults: `llmClient` and the `geminiEngine` fallback used the first,
// `.env.example` named both. Every caller catches the LLM error and falls back, so a dead default
// does not fail loudly: feature estimation, genre backfill, generation, captions and vibe tags
// quietly degrade instead.
//
// Source: https://console.groq.com/docs/deprecations, section "August 16, 2026: llama-3.1-8b-instant
// and llama-3.3-70b-versatile", fetched 2026-09-29:
//   | llama-3.1-8b-instant    | 08/16/26 | openai/gpt-oss-20b                      |
//   | llama-3.3-70b-versatile | 08/16/26 | openai/gpt-oss-120b or qwen/qwen3.6-27b |
//
// WHAT IT SWEEPS. Every place a model default can be set for the backend at runtime: the source
// under app/, scripts/ and sim/, plus .env.example, the Dockerfile and package.json. Tests are out of
// scope on purpose - this file has to name the dead IDs to ban them.
//
// WHEN GROQ RETIRES ANOTHER MODEL WE USE: add its ID to DECOMMISSIONED with the section heading and
// the date you fetched the page, then fix whatever this guard turns red.

jest.mock('axios');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const BACKEND = path.resolve(__dirname, '..');

const DECOMMISSIONED = [
  'llama-3.1-8b-instant',
  'llama-3.3-70b-versatile',
];

const SWEPT_DIRS = ['app', 'scripts', 'sim'];
const SWEPT_FILES = ['.env.example', 'Dockerfile', 'package.json'];

// Pure over [{ rel, text }] so the self-test below drives the same code path as the real sweep.
function findDecommissioned(files) {
  const hits = [];
  for (const { rel, text } of files) {
    text.split(/\r?\n/).forEach((line, i) => {
      const lower = line.toLowerCase();
      for (const id of DECOMMISSIONED) {
        if (lower.includes(id)) hits.push(`${rel}:${i + 1} ${id}`);
      }
    });
  }
  return hits;
}

function sweptFiles() {
  const rels = [];
  for (const dir of SWEPT_DIRS) {
    const abs = path.join(BACKEND, dir);
    for (const sub of fs.readdirSync(abs, { recursive: true })) {
      if (!fs.statSync(path.join(abs, sub)).isFile()) continue;
      rels.push(`${dir}/${sub.split(path.sep).join('/')}`);
    }
  }
  for (const f of SWEPT_FILES) if (fs.existsSync(path.join(BACKEND, f))) rels.push(f);
  return rels
    .map((rel) => ({ rel, text: fs.readFileSync(path.join(BACKEND, rel), 'utf8') }))
    .filter(({ text }) => !text.includes('\u0000'));
}

describe('decommissioned Groq model guard', () => {
  // A guard that silently stops matching is a false green: prove it has teeth on every run.
  describe('detector self-test', () => {
    it('catches a decommissioned ID as a code default and as an env value', () => {
      expect(findDecommissioned([
        { rel: 'app/x.js', text: "const DEFAULT_MODEL = 'llama-3.1-8b-instant';" },
        { rel: '.env.example', text: 'TEMPO_CRITIC_MODEL=llama-3.3-70b-versatile' },
      ])).toEqual([
        'app/x.js:1 llama-3.1-8b-instant',
        '.env.example:1 llama-3.3-70b-versatile',
      ]);
    });

    it('does not flag the replacements Groq recommends', () => {
      expect(findDecommissioned([
        { rel: 'app/x.js', text: "const DEFAULT_MODEL = 'openai/gpt-oss-20b';" },
        { rel: '.env.example', text: 'TEMPO_CRITIC_MODEL=openai/gpt-oss-120b' },
      ])).toEqual([]);
    });
  });

  describe('the sweep over backend runtime defaults', () => {
    const files = sweptFiles();

    it('actually read the files that set model defaults (an empty corpus would be a false green)', () => {
      const rels = files.map((f) => f.rel);
      expect(files.length).toBeGreaterThan(100);
      expect(rels).toEqual(expect.arrayContaining([
        'app/config/llmProvider.js', // holds DEFAULT_LLM_MODEL, the one code default
        'app/services/llmClient.js',
        'app/services/geminiEngine.js',
        '.env.example',
      ]));
    });

    it('no code default, fallback or .env.example value names a decommissioned model', () => {
      expect(findDecommissioned(files)).toEqual([]);
    });
  });

  // .env.example is what a fresh deploy copies. If its LLM_MODEL drifts from the code default, the
  // documented value and the running value disagree, and one of them can point at a dead model.
  describe('.env.example matches the code', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      process.env.LLM_API_KEY = 'test-key';
      delete process.env.LLM_MODEL;
      delete process.env.LLM_BASE_URL;
    });

    it('LLM_MODEL in .env.example is the model llmClient sends when LLM_MODEL is unset', async () => {
      const example = fs.readFileSync(path.join(BACKEND, '.env.example'), 'utf8');
      const documented = /^LLM_MODEL=(.*)$/m.exec(example)?.[1]?.trim();
      axios.post.mockResolvedValue({ data: { choices: [{ message: { content: '{}' } }] } });

      await require('../app/services/llmClient').generateJson('p');

      expect(documented).toBeTruthy();
      expect(axios.post.mock.calls[0][1].model).toBe(documented);
    });
  });
});
