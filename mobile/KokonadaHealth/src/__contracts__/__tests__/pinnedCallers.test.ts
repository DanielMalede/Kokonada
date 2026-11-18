/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { DEAD_LIST } from '../deadList';
import { pinFailures, scanPinnedExports } from '../../testing/guards/pinnedCallers';
import { APP_ROOT } from '../../testing/guards/productionImports';
import { moduleSpecifiers, readSource } from '../../testing/guards/sourceFiles';
import { loadTsConfig } from '../../testing/guards/tsProgram';

// QA-116 (Stage 0 Q1b): every production function a test pins has a production caller, or sits on the
// dead list with the TASKS row that schedules its removal. The list only shrinks: an entry whose export
// gained a caller, or that no test pins any more, fails until it is removed.

const TIMEOUT = 60_000;
const DEAD_LIST_FILE = path.join(APP_ROOT, 'src/__contracts__/deadList.ts');
const TASKS = path.resolve(APP_ROOT, '../../TASKS.md');

describe('QA-116 · the dead list', () => {
  it('is data only: it imports nothing', () => {
    expect(moduleSpecifiers(readSource(DEAD_LIST_FILE), DEAD_LIST_FILE)).toEqual([]);
  });

  it('cites an open TASKS.md row for every entry', () => {
    const tasks = fs.readFileSync(TASKS, 'utf8');
    expect(DEAD_LIST.length).toBeGreaterThan(0);
    for (const entry of DEAD_LIST) {
      expect(entry.row).toMatch(/^[A-Z]+-\d+$/);
      expect({ entry: `${entry.file}#${entry.name}`, open: tasks.includes(`- [ ] \`${entry.row}\``) })
        .toEqual({ entry: `${entry.file}#${entry.name}`, open: true });
    }
  });
});

describe('QA-116 · every pinned production export has a production caller', () => {
  it('0 pinned exports without a caller outside the dead list', () => {
    const scan = scanPinnedExports(loadTsConfig());
    console.log(`QA-116: ${scan.pinned.length} pinned callable exports over ${scan.testFiles} test files and ${scan.productionFiles} production files; `
      + `dead list: ${DEAD_LIST.map((e) => `${e.file}#${e.name} (${e.row})`).join(', ')}`);
    expect(scan.pinned.length).toBeGreaterThan(0);
    expect(pinFailures(scan, DEAD_LIST)).toEqual([]);
  }, TIMEOUT);
});
