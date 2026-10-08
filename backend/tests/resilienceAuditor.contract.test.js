'use strict';

// The resilience audit runs on two sides of this repository: the owner's side dispatches the
// `resilience-auditor` agent (`.claude/agents/resilience-auditor.md`); the partner's side runs the
// `$resilience-audit` skill (`.agents/skills/resilience-audit/SKILL.md`) on his own branch. They are
// the same protocol written twice, for two tools that cannot read each other's files, so without a
// pin the two copies drift apart and the two partners end up auditing to different standards.
//
// This file is that pin. It reads both copies and asserts that the parts that define the standard are
// identical: the method's step titles, the severity calibration rows, the report's section names and
// the verdict lines. It also asserts that the audit is wired into the ship flow on both sides, that the
// agent may run the suite (tools include Bash) and that every report declares what it ran on.

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').replace(/\r\n/g, '\n');

const AGENT = '.claude/agents/resilience-auditor.md';
const SKILL = '.agents/skills/resilience-audit/SKILL.md';

// A `## Heading` section's body, up to the next `## ` heading.
function section(text, heading) {
  const part = text.split(/^## /m).find((p) => p.startsWith(heading + '\n'));
  if (!part) throw new Error('section "## ' + heading + '" missing');
  return part.slice(heading.length + 1);
}

// `N. **Title.**` lines of the method, in order.
const stepTitles = (text) =>
  [...section(text, 'Method').matchAll(/^\d+\. \*\*([^*]+)\*\*/gm)].map((m) => m[1]);

// The rows of the severity table: `| S0 | ... |`.
const severityRows = (text) =>
  [...section(text, 'Severity').matchAll(/^\| (S[0-3]) \|.*\|$/gm)].map((m) => m[0]);

const frontmatter = (text) => text.match(/^---\n([\s\S]*?)\n---\n/)[1];

const REPORT_SECTIONS = ['RUN:', 'EVIDENCE:', 'FINDINGS:', 'BLOCKING IDS:', 'NOT VERIFIED:', 'PRIOR FINDINGS:', 'PROPOSED TESTS:', 'STABILITY:'];
const VERDICTS = ['VERDICT: APPROVE @ <sha>', 'VERDICT: BLOCK @ <sha>'];

describe('resilience audit: one protocol on both sides', () => {
  const agent = read(AGENT);
  const skill = read(SKILL);

  it('the agent may run the suite, on opus at max effort', () => {
    const fm = frontmatter(agent);
    expect(fm).toMatch(/^tools: .*\bBash\b/m);
    expect(fm).toMatch(/^model: opus$/m);
    expect(fm).toMatch(/^effort: max$/m);
  });

  it('the skill names itself for Codex', () => {
    expect(frontmatter(skill)).toMatch(/^name: resilience-audit$/m);
  });

  it('the method has the same steps, in the same order', () => {
    const a = stepTitles(agent);
    expect(a.length).toBeGreaterThanOrEqual(9);
    expect(stepTitles(skill)).toEqual(a);
  });

  it('severity is calibrated by the same four rows', () => {
    const a = severityRows(agent);
    expect(a.map((r) => r.slice(0, 6))).toEqual(['| S0 |', '| S1 |', '| S2 |', '| S3 |']);
    expect(severityRows(skill)).toEqual(a);
  });

  it('the report has the same sections and the same two verdict lines', () => {
    for (const text of [agent, skill]) {
      for (const s of REPORT_SECTIONS) expect(text).toContain(s);
      for (const v of VERDICTS) expect(text).toContain(v);
      // The verdict is the report's last line, as the merge rule reads it.
      expect(text).toMatch(/last line/i);
    }
  });

  it('every report declares the model and the effort it ran on', () => {
    for (const text of [agent, skill]) expect(section(text, 'Report')).toMatch(/RUN: <model> · effort <level>/);
  });

  it('the agent never runs code from a tree under review', () => {
    const regimes = section(agent, 'Two regimes');
    expect(regimes).toMatch(/core\.hooksPath=\/dev\/null/);
    expect(regimes).toMatch(/never (build|run|execute)/i);
  });

  it('the author never audits in the thread that wrote the code', () => {
    expect(section(skill, 'Two regimes')).toMatch(/fresh thread|new thread/i);
  });
});

describe('resilience audit: wired into the ship flow on both sides', () => {
  it('the owner side: /ship runs the auditor before the PR is made ready, and a BLOCK fails the task', () => {
    const ship = read('.claude/commands/ship.md');
    expect(ship).toMatch(/resilience-auditor[\s\S]*gh pr ready/);
    expect(ship).toMatch(/VERDICT: BLOCK/);
  });

  it('the partner side: $coordinate and AGENTS.md send him to $resilience-audit before gh pr ready', () => {
    const coordinate = read('.agents/skills/coordinate/SKILL.md');
    expect(coordinate).toMatch(/\$resilience-audit[\s\S]*gh pr ready/);
    const agents = read('AGENTS.md');
    expect(agents).toMatch(/\$resilience-audit/);
    expect(agents).toMatch(/\.agents\/skills\/resilience-audit\/SKILL\.md/);
  });

  it('AGENTS.md tells the partner the model and effort the work runs on', () => {
    expect(read('AGENTS.md')).toMatch(/reasoning effort/i);
  });
});
