/// <reference types="node" />
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { pathToFileURL } from 'node:url';
import { normalizeEol } from '../guards/contracts';
import { APP_ROOT } from '../guards/productionImports';
import * as retire from '../guards/retire';
import * as rule from '../guards/retireRule';
import { moduleSpecifiers, readSource } from '../guards/sourceFiles';

// The RETIRE signature rule in a module of its own (OPS-412 part A). QA-041's CLI runs it under plain
// Node 24 by type stripping, outside jest and babel, so the module must load and run there; retire.ts
// re-exports it, so the jest guards and the CLI share one implementation. The real decision records
// are read from the tree; planted inputs are in memory or in os.tmpdir() (D8 rule 2).

const RULE_FILE = path.join(APP_ROOT, 'src/testing/guards/retireRule.ts');
const DECISIONS = path.resolve(APP_ROOT, '../../docs/design-v2/decisions');

const ENTRIES = [
  { kind: 'file', target: 'f-ok', dec: 'DEC-900', reason: 'r' },
  { kind: 'pin', target: 'p-rule', dec: 'DEC-091', reason: 'r' },
  { kind: 'file', target: 'f-open', dec: 'DEC-901', reason: 'r' },
  { kind: 'file', target: 'f-id', dec: 'D12', reason: 'r' },
  { kind: 'pin', target: 'p-gone', dec: 'DEC-998', reason: ' ' },
  { kind: 'file', target: 'f-ok', dec: 'DEC-900', reason: 'r' },
];
const IDS = ['DEC-091', 'DEC-142', 'DEC-155', 'DEC-999', 'DEC-91', '../DEC-091'];
const CRLF_RECORD = '---\r\nid: DEC-1\r\nstatus: OPEN\r\n---\r\n';

interface NodeRun {
  typescript: string | null;
  exports: string[];
  decId: string;
  rules: string[];
  crlf: string | null;
  statuses: Record<string, string | null>;
  failures: string[];
}

/** A child Node process, not jest: import retireRule.ts by its file URL and run every export once. */
function importThroughNode(): { status: number | null; stderr: string; run: NodeRun | null } {
  const script = [
    `const m = await import(${JSON.stringify(pathToFileURL(RULE_FILE).href)});`,
    "const stub = (dec) => (dec === 'DEC-900' ? 'DECIDED' : dec === 'DEC-901' ? 'OPEN' : null);",
    `const dir = ${JSON.stringify(DECISIONS)};`,
    `const ids = ${JSON.stringify(IDS)};`,
    'console.log(JSON.stringify({',
    'typescript: process.features.typescript ?? null,',
    'exports: Object.keys(m).sort(),',
    'decId: String(m.DEC_ID),',
    'rules: [...m.RULE_DECS],',
    `crlf: m.parseDecStatus(${JSON.stringify(CRLF_RECORD)}),`,
    'statuses: Object.fromEntries(ids.map((id) => [id, m.readDecStatus(id, dir)])),',
    `failures: m.checkRetireEntries(${JSON.stringify(ENTRIES)}, stub),`,
    '}));',
  ].join(' ');
  // Plain Node: no flag or loader inherited from the parent, so a pass means the default type stripping.
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: APP_ROOT, encoding: 'utf8', timeout: 30_000, env });
  let run: NodeRun | null = null;
  try { run = JSON.parse(r.stdout) as NodeRun; } catch { run = null; }
  return { status: r.status, stderr: `${r.stderr ?? ''}${r.error ? `\n${r.error.message}` : ''}`, run };
}

describe('retireRule.ts under plain Node 24 (the QA-041 CLI, OPS-412)', () => {
  it('Node imports it by type stripping alone, and every export runs there', () => {
    const r = importThroughNode();
    // stderr is shown only when the child fails; it is never asserted empty (Node may print a warning).
    expect({ status: r.status, stderr: r.status === 0 ? '' : r.stderr }).toEqual({ status: 0, stderr: '' });
    expect(r.run).toEqual({
      typescript: 'strip',
      exports: ['DEC_ID', 'RULE_DECS', 'checkRetireEntries', 'parseDecStatus', 'readDecStatus'],
      decId: String(/^DEC-\d{3,}$/),
      rules: ['DEC-091', 'DEC-142'],
      crlf: 'OPEN',
      statuses: { 'DEC-091': 'DECIDED', 'DEC-142': 'DECIDED', 'DEC-155': 'DECIDED', 'DEC-999': null, 'DEC-91': null, '../DEC-091': null },
      failures: [
        'RETIRE pin p-rule: DEC-091 is the RETIRE rule itself, not a signature',
        'RETIRE file f-open: DEC-901 is OPEN, not DECIDED',
        'RETIRE file f-id: D12 is not a DEC-nnn id',
        'RETIRE pin p-gone: DEC-998 does not exist',
        'RETIRE pin p-gone: no reason',
        'RETIRE file f-ok: named twice',
      ],
    });
  }, 60_000);

  // The child above cannot catch this one: where the app's node_modules is installed, Node resolves a
  // typescript import and the child passes. The CLI's own rule (OPS-412) is no typescript, so it is held here.
  it('imports only node:fs and node:path, by those names: no typescript and no relative module', () => {
    expect([...new Set(moduleSpecifiers(readSource(RULE_FILE), RULE_FILE))].sort()).toEqual(['node:fs', 'node:path']);
  });
});

describe('retire.ts re-exports the rule: one implementation, never two copies', () => {
  it('the moved exports are the same objects through both modules', () => {
    // One assertion, so a failure names every export retire.ts holds a copy of, not only the first.
    expect({
      DEC_ID: retire.DEC_ID === rule.DEC_ID,
      RULE_DECS: retire.RULE_DECS === rule.RULE_DECS,
      parseDecStatus: retire.parseDecStatus === rule.parseDecStatus,
      checkRetireEntries: retire.checkRetireEntries === rule.checkRetireEntries,
    }).toEqual({ DEC_ID: true, RULE_DECS: true, parseDecStatus: true, checkRetireEntries: true });
    expect([...rule.RULE_DECS]).toEqual(['DEC-091', 'DEC-142']);
  });

  it('readDecStatus agrees through both modules on DEC-091, DEC-142 and DEC-155, and the default folder is the real one', () => {
    expect(retire.DECISIONS_DIR).toBe(DECISIONS);
    for (const dec of ['DEC-091', 'DEC-142', 'DEC-155']) {
      expect([dec, retire.readDecStatus(dec), rule.readDecStatus(dec, DECISIONS)]).toEqual([dec, 'DECIDED', 'DECIDED']);
    }
    // retire.ts's readDecStatus still serves as a one-argument DecStatus that reads the default folder.
    expect(retire.checkRetireEntries([{ kind: 'pin', target: 'p', dec: 'DEC-155', reason: 'r' }], retire.readDecStatus)).toEqual([]);
    expect(retire.checkRetireEntries([{ kind: 'pin', target: 'p', dec: 'DEC-999', reason: 'r' }], retire.readDecStatus))
      .toEqual(['RETIRE pin p: DEC-999 does not exist']);
  });

  it('readDecStatus agrees on every record of the real folder, and on ids that name no record', () => {
    const ids = fs.readdirSync(DECISIONS).filter((f) => /^DEC-\d{3,}\.md$/.test(f)).map((f) => f.slice(0, -3)).sort();
    expect(ids.length).toBeGreaterThan(100);
    expect(ids.filter((dec) => retire.readDecStatus(dec) !== rule.readDecStatus(dec, DECISIONS))).toEqual([]);
    for (const dec of ['DEC-999', 'DEC-91', 'dec-091', 'DEC-091.md', '../DEC-091', '']) {
      expect([dec, retire.readDecStatus(dec), rule.readDecStatus(dec, DECISIONS)]).toEqual([dec, null, null]);
    }
  });

  it('readDecStatus reads a planted folder the same through both modules', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'retire-rule-'));
    try {
      fs.writeFileSync(path.join(dir, 'DEC-900.md'), '---\nid: DEC-900\nstatus: DECIDED\n---\n');
      fs.writeFileSync(path.join(dir, 'DEC-901.md'), '---\r\nid: DEC-901\r\nstatus: OPEN\r\n---\r\n');
      fs.writeFileSync(path.join(dir, 'DEC-902.md'), 'no front matter\nstatus: DECIDED\n');
      fs.writeFileSync(path.join(dir, 'DEC-91.md'), '---\nstatus: DECIDED\n---\n');
      const cases: Array<[string, string | null]> = [['DEC-900', 'DECIDED'], ['DEC-901', 'OPEN'], ['DEC-902', null], ['DEC-903', null], ['DEC-91', null]];
      for (const [dec, want] of cases) {
        expect([dec, retire.readDecStatus(dec, dir), rule.readDecStatus(dec, dir)]).toEqual([dec, want, want]);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('parseDecStatus reads CRLF and lone-CR records as LF, as normalizeEol does', () => {
    const lf = '---\nid: DEC-1\nstatus: DECIDED\n---\n- status: OPEN\n';
    for (const text of [lf, lf.split('\n').join('\r\n'), lf.split('\n').join('\r')]) {
      expect(normalizeEol(text)).toBe(lf);
      expect([JSON.stringify(text), rule.parseDecStatus(text)]).toEqual([JSON.stringify(text), 'DECIDED']);
    }
  });
});
