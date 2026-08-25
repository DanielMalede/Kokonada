'use strict';

// W4-D78 - the attribution standing order is the one rule `CLAUDE.md` writes in capitals and calls
// NON-NEGOTIABLE, and until this file existed it was the only project rule enforced by nothing but
// memory. Reflection #14 proved memory is not enough: an authorship-credit parenthetical reached a
// tracked file, was committed by a session that was scanning only its own code diff, and a whole-tree
// sweep then found three more that every prior reflection had missed for the same structural reason.
//
// WHY A TEST AND NOT A SCRIPT (the W4-D11 precedent). A script only runs when somebody remembers, and
// the whole point of this class of defect is that nobody did. The backend suite is the gate every task
// already has to pass, so the guard runs there - alongside W4-D01's marker, W4-D02's state-guard,
// W4-D06's open-handle guard and W4-D11's linter.
//
// WHY THE WHOLE TRACKED TREE AND NOT `backend/app` (the W4-D79 lesson). The violation landed in
// `docs/plans/`, and the residue this guard found on its first run was in `scripts/`. A guard rooted at
// the source directory would have seen neither. `git ls-files` is the enumerator because "tracked" is
// exactly the boundary that matters: Daniel's untracked local workstream is his, not the wave's.
//
// THE BOUNDARY IT ENCODES (HITL H8, as narrowed by reflection #14). Two categories of mention exist and
// only one is forbidden:
//   CREDIT       - naming an agent as the author of project work ("(<agent>, root cause of ...)",
//                  "Co-Authored-By: ...", "Generated with ..."). This is what the standing order bans.
//   OPERATIONAL  - process names and CLI invocations (`claude.exe`, `claude --version`, `.claude/`),
//                  which describe the machinery a human drives. H8 records the standing judgement that
//                  these are NOT attribution; they are stripped before the credit patterns run, so the
//                  allow-list is load-bearing rather than decorative.
//
// THE PRE-WAVE BOUNDARY IS COMPUTED, NOT REMEMBERED. `CLAUDE.md` says the policy applies going forward
// only and never rewrites published history, and two July plans under `docs/superpowers/plans/` predate
// it. They are exempt because their filename date is before the run started - not because they are on a
// list. A plan filed there tomorrow, or one with no date in its name, is in scope.

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');

// The run's start (WAVE4_STATE `runStartedAt`). A `docs/superpowers/plans/` file whose name carries a
// date strictly before this predates the standing order's forward-only scope.
const WAVE_START = '2026-08-18';
const PRE_WAVE_DIR = 'docs/superpowers/plans/';

// Files whose PURPOSE is to state the ban, and which therefore have to quote the strings it forbids.
// Deliberately a closed literal: growing it means editing the equality assertion below, which is a
// visible act in review rather than a quiet append that reopens the hole this guard closes.
const POLICY_TEXTS = {
  'CLAUDE.md': 'the standing order itself - it enumerates the forbidden strings verbatim',
  'docs/ORCHESTRATOR_FABLE.md': 'the orchestration directive, whose attribution policy is the source of truth',
};

// This file carries the fixtures the detector is tested against.
const SELF = 'backend/tests/wave4.attributionGuard.test.js';

// Machinery vocabulary: a human running the CLI, a script counting its process, a path under `.claude/`.
// Stripped BEFORE the credit patterns run. Note what is deliberately absent: `using`/`used`, because
// "created using <agent>" is a credit, not an invocation.
const OPERATIONAL = [
  /\bclaude\.exe\b/gi, // wave4-doctor.ps1 counts the process
  /\bclaude\s+(?:-{1,2}[\w-]+|mcp|code\s+CLI)\b/gi, // `claude --version`, `claude -p`, `claude mcp`
  /@anthropic-ai\/claude-code\b/gi, // the npm package you install
  /\.claude[\\/][\w./\\-]*/gi, // .claude/settings.json, .claude/agents/...
  /\bCLAUDE(?:_[A-Z0-9_]+)?\.md\b/g, // CLAUDE.md, CLAUDE_DESIGN_PROMPT.md
  /\bclaude(?:\s+code)?\s+(?:CLI|process(?:es)?)\b/gi, // H8's process-name mentions
  // An instruction to a human: "open a Claude Code session", "run the CLI". Imperative, not a credit.
  /\b(?:open|opens|opened|opening|launch|launches|launched|launching|start|starts|started|starting|run|runs|ran|running)\s+(?:an?|the|one|another)?\s*(?:interactive\s+)?claude(?:\s+code)?(?:\s+session)?\b/gi,
];

function stripOperational(line) {
  return OPERATIONAL.reduce((acc, re) => acc.replace(re, ' '), line);
}

// Authorship-credit shapes. Several match nothing in the tree today and are FORWARD-BINDING by design -
// the ADR-0012 tripwire's idiom: the assertion arms itself the moment the string lands.
const CREDIT_PATTERNS = [
  ['co-author trailer', /^[ \t>*\-]*co-authored-by:[^\n]*\b(?:claude|anthropic|copilot|ai)\b/i],
  ['generated-with credit', /\bgenerated\s+(?:with|by)\s+\[?(?:claude|anthropic)\b/i],
  ['agent as author', /\b(?:written|authored|created|produced|generated|diagnosed|drafted|implemented|built|made|fixed|resolved|reviewed|designed)\s+(?:by|with|via|using)\s+(?:an?|the)?\s*(?:claude|anthropic)\b/i],
  ['agent as subject', /\bclaude(?:\s+code)?\s+(?:wrote|authored|generated|created|produced|made|built|diagnosed|fixed|implemented|reviewed|designed)\b/i],
  ['credit parenthetical', /\(\s*(?:by\s+|via\s+)?(?:claude(?:\s+code)?|anthropic)\s*[,)]/i],
  ['agent session credit', /\b(?:an?|the)\s+claude(?:\s+code)?\s+session\b/i],
  ['ai-authorship claim', /\bai[-\s]?(?:generated|authored|written|assisted)\b/i],
  ['made-with-ai claim', /\b(?:made|built|created|generated)\s+with\s+ai\b/i],
  // An instruction to APPEND a credit is part of the same class - it is how the July plans carried it.
  ['credit footer reference', /\b(?:claude(?:\s+code)?|anthropic)\s+(?:attribution\s+)?footer\b/i],
];

// Every credit string on a line, after the operational vocabulary has been removed.
function credits(text) {
  const out = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const cleaned = stripOperational(line);
    for (const [name, re] of CREDIT_PATTERNS) {
      if (re.test(cleaned)) {
        out.push({ line: i + 1, pattern: name, text: line.trim().slice(0, 120) });
        break;
      }
    }
  });
  return out;
}

// A `docs/superpowers/plans/2026-07-05-*.md` predates the standing order. An undated name there, or a
// date on or after the run start, does not - the boundary is computed from the filename, not recalled.
function isPreWavePlan(rel) {
  if (!rel.startsWith(PRE_WAVE_DIR)) return false;
  const m = /^(\d{4}-\d{2}-\d{2})-/.exec(path.posix.basename(rel));
  return Boolean(m) && m[1] < WAVE_START;
}

function isExempt(rel) {
  return rel === SELF || Object.prototype.hasOwnProperty.call(POLICY_TEXTS, rel) || isPreWavePlan(rel);
}

// The whole guard as a PURE function over [{rel, text}], so the self-tests below exercise the same code
// path the real sweep does instead of a look-alike.
function sweep(files) {
  const findings = [];
  for (const { rel, text } of files) {
    if (isExempt(rel)) continue;
    for (const hit of credits(text)) findings.push(`${rel}:${hit.line} [${hit.pattern}] ${hit.text}`);
  }
  return findings;
}

const BINARY_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.svg', '.pdf', '.zip', '.jar', '.aar', '.apk',
  '.keystore', '.jks', '.ttf', '.otf', '.woff', '.woff2', '.mp3', '.wav', '.bin', '.so', '.dylib', '.dll',
]);

function trackedTextFiles() {
  const listed = execFileSync('git', ['ls-files', '-z'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
    .split('\0')
    .filter(Boolean);
  const files = [];
  for (const rel of listed) {
    if (BINARY_EXT.has(path.extname(rel).toLowerCase())) continue;
    let text;
    try {
      text = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
    } catch {
      continue;
    }
    if (text.includes('\u0000')) continue; // binary without a known extension
    files.push({ rel, text });
  }
  return files;
}

describe('W4-D78 - attribution guard (CLAUDE.md standing order)', () => {
  // A structural guard that silently stops matching is a FALSE GREEN. Prove the detector has teeth on
  // every run, not just the day it was written.
  describe('detector self-test - credit is caught', () => {
    it('catches a co-author trailer naming an agent', () => {
      expect(credits('Co-Authored-By: Claude <noreply@anthropic.com>')).toHaveLength(1);
    });

    it('catches a generated-with footer, with or without the glyph', () => {
      expect(credits('\uD83E\uDD16 Generated with Claude Code')).toHaveLength(1);
      expect(credits('Generated with Claude Code')).toHaveLength(1);
    });

    it('catches the parenthetical shape that actually reached the tree', () => {
      expect(credits('DIAGNOSED 2026-08-23 (Claude Code, root cause of the empty index)')).toHaveLength(1);
    });

    it('catches an agent credited with project work by verb or by session', () => {
      expect(credits('The index was created using Claude Code.')).toHaveLength(1);
      expect(credits('RESOLVED (Daniel, via Atlas UI + a Claude Code session).')).toHaveLength(1);
      expect(credits('Claude Code built the query index cleanly.')).toHaveLength(1);
    });

    it('catches the brand-free vocabulary the standing order also names', () => {
      expect(credits('This module is AI-generated.')).toHaveLength(1);
      expect(credits('Made with AI.')).toHaveLength(1);
    });
  });

  describe('detector self-test - operational vocabulary is NOT credit (HITL H8)', () => {
    it('separates a co-author trailer from a --version invocation', () => {
      expect(credits('Co-Authored-By: Claude <noreply@anthropic.com>')).toHaveLength(1);
      expect(credits('2. run `claude --version` - works and is signed in.')).toHaveLength(0);
    });

    it('ignores process names, package names and dotted paths', () => {
      expect(credits("$cliPath = 'C:\\Users\\danie\\.local\\bin\\claude.exe'")).toHaveLength(0);
      expect(credits('npm install -g @anthropic-ai/claude-code')).toHaveLength(0);
      expect(credits('`.claude/settings.json` sets `includeCoAuthoredBy: false`.')).toHaveLength(0);
      expect(credits('every real session shows up as a claude process')).toHaveLength(0);
    });

    it('ignores an instruction to a human but not a credit for work already done', () => {
      expect(credits('Open a Claude Code session in the project folder.')).toHaveLength(0);
      expect(credits('the fix landed via a Claude Code session')).toHaveLength(1);
    });

    it('ignores a human co-author trailer - the ban is on agent attribution', () => {
      expect(credits('Co-Authored-By: Daniel <danielmalede@gmail.com>')).toHaveLength(0);
    });
  });

  describe('scope boundaries are computed, not remembered', () => {
    const FOOTER = 'PR body ends with the Claude Code footer.';

    it('exempts a pre-wave plan by its filename date', () => {
      expect(sweep([{ rel: `${PRE_WAVE_DIR}2026-07-05-ws1-feature-hydration-repair.md`, text: FOOTER }])).toEqual([]);
    });

    it('does NOT exempt a plan filed after the run started, or one with no date in its name', () => {
      expect(sweep([{ rel: `${PRE_WAVE_DIR}2026-09-01-something.md`, text: FOOTER }])).toHaveLength(1);
      expect(sweep([{ rel: `${PRE_WAVE_DIR}frontend-watch-integration-plan.md`, text: FOOTER }])).toHaveLength(1);
    });

    it('does NOT exempt the run state files - that is where the violation landed', () => {
      expect(sweep([{ rel: 'docs/plans/WAVE4_STATE.md', text: 'Co-Authored-By: Claude <x>' }])).toHaveLength(1);
      expect(sweep([{ rel: 'scripts/close-h4.ps1', text: FOOTER }])).toHaveLength(1);
    });

    it('exempts the policy texts, which must quote what they forbid', () => {
      for (const rel of Object.keys(POLICY_TEXTS)) {
        expect(sweep([{ rel, text: 'Generated with Claude Code' }])).toEqual([]);
      }
    });
  });

  describe('the exemption list cannot quietly grow', () => {
    it('is exactly the two policy documents', () => {
      expect(Object.keys(POLICY_TEXTS).sort()).toEqual(['CLAUDE.md', 'docs/ORCHESTRATOR_FABLE.md']);
    });

    it('every exempt path exists and still declares the ban (a stale exemption is a hole)', () => {
      for (const rel of Object.keys(POLICY_TEXTS)) {
        const abs = path.join(REPO_ROOT, rel);
        expect(fs.existsSync(abs)).toBe(true);
        expect(fs.readFileSync(abs, 'utf8')).toMatch(
          /^(?=.*\battribution\b)(?=.*\b(?:FORBIDDEN|NEVER|Never|never)\b).*$/m,
        );
      }
    });
  });

  describe('the sweep over the tracked tree', () => {
    const files = trackedTextFiles();

    it('actually read the repository (an empty corpus would be a false green)', () => {
      expect(files.length).toBeGreaterThan(500);
      expect(files.map((f) => f.rel)).toContain('CLAUDE.md');
      expect(files.map((f) => f.rel)).toContain('docs/plans/WAVE4_STATE.md');
    });

    it('no tracked file credits an agent with project work', () => {
      expect(sweep(files)).toEqual([]);
    });
  });
});
