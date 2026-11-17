// UI-239's oracle for lawParity: a run's report against the report each of its rows gets alone. A manifest of one row
// cannot share a twin with any other row, so its section for the row (the header line, the |Δ| histograms, the counts
// and every pixel over 1 by region, the crop lines, PASS or FAIL) and its ×8 crops are what that row's own twin makes.
// Test-only; used by reportsLawParityShare.test.ts and reportsHarness.test.ts.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const APP = path.resolve(__dirname, '../../../..');
const SCRIPT = path.join(APP, 'scripts/lab/reports/lawParity.mts');
const COUNTER = path.join(__dirname, 'countSurfaces.cjs');

type Row = Record<string, unknown>;

export interface Run {
  readonly status: number | null;
  readonly stderr: string;
  readonly report: string;
  readonly crops: ReadonlyMap<string, Buffer>;
  /** The CanvasKit surfaces the run made (countSurfaces.cjs): two per field twin rendered, one per fallback twin. */
  readonly surfaces: number;
}

/** lawParity on a manifest, in a child node, with the CanvasKit surfaces it makes counted. */
export function runLawParity(manifestFile: string, out: string): Promise<Run> {
  const count = `${out}.surfaces`;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--no-warnings', '--require', COUNTER, SCRIPT, '--manifest', manifestFile, '--out', out], {
      cwd: APP, env: { ...process.env, UI239_SURFACES: count }, stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (d: string) => { stderr += d; });
    child.on('error', reject);
    child.on('close', (status) => {
      const crops = `${out.replace(/\.txt$/, '')}.crops`;
      resolve({
        status, stderr, report: fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '',
        crops: fs.existsSync(crops) ? new Map(fs.readdirSync(crops).map((f) => [f, fs.readFileSync(path.join(crops, f))])) : new Map(),
        surfaces: fs.existsSync(count) ? Number(fs.readFileSync(count, 'utf8')) : NaN,
      });
    });
  });
}

/** The report's lines for one row: from its header to the next unindented line; none if the row has no section. */
export function section(report: string, name: string): string[] {
  const lines = report.split('\n');
  const start = lines.findIndex((l) => l.startsWith(`row ${name} `));
  if (start < 0) return [];
  const end = lines.findIndex((l, i) => i > start && !l.startsWith('  '));
  return lines.slice(start, end === -1 ? undefined : end);
}

export interface RowAlone {
  readonly name: string;
  /** lawParity's exit code on the row alone. */
  readonly status: number | null;
  readonly stderr: string;
  /** The row's section in its own report, and in the run's. */
  readonly own: string[];
  readonly shared: string[];
  /** The row's crops (file, base64) in its own report, and the same files in the run's (null where missing). */
  readonly cropsOwn: Array<[string, string]>;
  readonly cropsShared: Array<[string, string | null]>;
}

/**
 * The run's report and crops against each row's own: each row in a manifest of its own beside the run's PNGs, at most
 * `parallel` at a time.
 */
export async function againstRowsAlone(manifestFile: string, outDir: string, parallel = 4): Promise<{ whole: Run; rows: RowAlone[] }> {
  const whole = await runLawParity(manifestFile, path.join(outDir, 'whole.txt'));
  const m = JSON.parse(fs.readFileSync(manifestFile, 'utf8')) as { rows: Row[] };
  const rows: RowAlone[] = new Array(m.rows.length);
  let next = 0;
  const worker = async () => {
    for (let i = next++; i < m.rows.length; i = next++) {
      const r = m.rows[i];
      const single = path.join(path.dirname(manifestFile), `alone-${i}.json`);
      fs.writeFileSync(single, JSON.stringify({ ...m, rows: [r] }));
      const alone = await runLawParity(single, path.join(outDir, `alone-${i}.txt`));
      const name = `${r.shot}.${r.repeat}`;
      const files = [...alone.crops.keys()].filter((f) => f.startsWith(`${name}.`));
      rows[i] = {
        name, status: alone.status, stderr: alone.stderr, own: section(alone.report, name), shared: section(whole.report, name),
        cropsOwn: files.map((f) => [f, alone.crops.get(f)!.toString('base64')]),
        cropsShared: files.map((f) => [f, whole.crops.get(f)?.toString('base64') ?? null]),
      };
    }
  };
  await Promise.all(Array.from({ length: parallel }, worker));
  return { whole, rows };
}
