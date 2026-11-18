/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { DEAD_LIST } from '../deadList';
import { pinFailures, scanPinnedExports } from '../../testing/guards/pinnedCallers';
import { APP_ROOT } from '../../testing/guards/productionImports';
import { isTestFile, moduleSpecifiers, readSource } from '../../testing/guards/sourceFiles';
import { loadTsConfig } from '../../testing/guards/tsProgram';

// QA-116 (Stage 0 Q1b): every production function a test pins has a production caller, or sits on the
// dead list with the TASKS row that schedules its removal. The list only shrinks: an entry whose export
// gained a caller, or that no test pins any more, fails until it is removed.

const TIMEOUT = 60_000;
const DEAD_LIST_FILE = path.join(APP_ROOT, 'src/__contracts__/deadList.ts');
const TASKS = path.resolve(APP_ROOT, '../../TASKS.md');

// The dead list's ceiling: it may shrink freely, and grows only by editing this number on purpose, in
// the PR that adds the entry and its row (13: RA-1 of #292's audit added useRealtimeFieldClock and advanceFieldTime).
const DEAD_LIST_CEILING = 13;
// A floor under the pin count, near the 212 measured on 2026-11-18 (after the class and require() pins
// were counted): a scan that silently loses most of its pins fails here, not just a scan over nothing.
const PINNED_FLOOR = 200;

// The tsconfig's own reach: every .ts/.tsx under the app outside node_modules and Pods (its excludes).
// walkSources is not used here: it also skips every directory named ios, android or build (OPS-439).
const SKIP = new Set(['node_modules', 'Pods', '.git', '.gradle']);
function tsTestFilesOnDisk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) tsTestFilesOnDisk(full, out);
    else if (entry.isFile() && /\.tsx?$/.test(entry.name) && !entry.name.endsWith('.d.ts') && isTestFile(full)) out.push(full);
  }
  return out;
}

/** The row's own line and its indented sub-lines, or undefined when the row is not open. */
function openRowBlock(tasks: string, row: string): string | undefined {
  const lines = tasks.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`- [ ] \`${row}\``));
  if (start < 0) return undefined;
  let end = start + 1;
  while (end < lines.length && lines[end].startsWith('  ')) end++;
  return lines.slice(start, end).join('\n');
}

describe('QA-116 · the dead list', () => {
  it('is data only: it imports nothing', () => {
    expect(moduleSpecifiers(readSource(DEAD_LIST_FILE), DEAD_LIST_FILE)).toEqual([]);
  });

  it('cites, for every entry, an open TASKS.md row that names the export in backticks', () => {
    const tasks = fs.readFileSync(TASKS, 'utf8');
    expect(DEAD_LIST.length).toBeGreaterThan(0);
    for (const entry of DEAD_LIST) {
      expect(entry.row).toMatch(/^[A-Z]+-\d+$/);
      const block = openRowBlock(tasks, entry.row);
      expect({ entry: `${entry.file}#${entry.name}`, open: block !== undefined, names: !!block?.includes(`\`${entry.name}\``) })
        .toEqual({ entry: `${entry.file}#${entry.name}`, open: true, names: true });
    }
  });

  it(`never grows past its ceiling of ${DEAD_LIST_CEILING} without an edit here`, () => {
    expect(DEAD_LIST.length).toBeLessThanOrEqual(DEAD_LIST_CEILING);
  });
});

describe('QA-116 · every pinned production export has a production caller', () => {
  it('0 pinned exports without a caller outside the dead list', () => {
    const scan = scanPinnedExports(loadTsConfig());
    const onDisk = tsTestFilesOnDisk(APP_ROOT).length;
    console.log(`QA-116: ${scan.pinned.length} pinned callable exports over ${scan.testFiles} test files (${onDisk} on disk), `
      + `${scan.productionFiles} production files, ${scan.releaseFiles} in the release closure; `
      + `dead list: ${DEAD_LIST.map((e) => `${e.file}#${e.name} (${e.row})`).join(', ')}`);
    expect(scan.testFiles).toBe(onDisk);
    expect(scan.pinned.length).toBeGreaterThanOrEqual(PINNED_FLOOR);
    expect(pinFailures(scan, DEAD_LIST)).toEqual([]);
  }, TIMEOUT);
});
