/// <reference types="node" />
// B8-7 (the architect's B8 plan at 199b138; QA-068's S7, TASKS UI-190): scripts/lab/reports/flashTrace.mts reads a
// recording of a storm scene as a sequence of frames with their timestamps and
//   · counts flashes per 24 × 24 dp cell with src/design/v2/field/flashCount.ts's own definition (relY and
//     worstFlashesPerSecond, imported, never restated), and fails when any cell has more than 2 in any 1 s window;
//   · reports the latency from each change of the storm marker (storm/stormMarker.ts) to the first changed field cell,
//     in frames and in ms, the marker's own cell never counting as the field.
// Frames get in through a pluggable input: a folder of PNG frames with frames.json (what these planted sets are, and
// what any decoder would write), or an mp4 from screenrecord through an ffmpeg the caller names, refused loudly when none
// is given. It exits 0 on PASS, 1 on FAIL, 2 on an input it cannot use (and writes no report); it never overwrites one.

import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

jest.setTimeout(240000);

const APP = path.resolve(__dirname, '../../..');
const SCRIPT = path.join(APP, 'scripts/lab/reports/flashTrace.mts');
const MAKE = path.join(APP, 'scripts/lab/reports/__fixtures__/makeFlashFrames.mts');

let root: string;
let sets: string;
let planted: { mp4Sha256: string; pxPerDp: number; cellPx: number; marker: { x: number; y: number; size: number }; greys: Record<string, number> };
beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'flash-'));
  sets = path.join(root, 'sets');
  const p = spawnSync(process.execPath, ['--no-warnings', MAKE, sets], { cwd: APP, encoding: 'utf8' });
  if (p.status !== 0) throw new Error(`makeFlashFrames failed: ${p.stderr}`);
  planted = JSON.parse(fs.readFileSync(path.join(sets, 'planted.json'), 'utf8'));
});
afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

let outs = 0;
function run(args: string[], out?: string) {
  const file = out ?? path.join(root, `report-${(outs += 1)}.txt`);
  const p = spawnSync(process.execPath, ['--no-warnings', SCRIPT, ...args, '--out', file], { cwd: APP, encoding: 'utf8' });
  return { status: p.status, stdout: p.stdout, stderr: p.stderr, report: fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null, file };
}
/** The marker from READY's marker probe in the planted manifest's row for the shot (the default), unless --marker is given. */
const mark = (shot = 'planted') => ['--manifest', path.join(sets, 'manifest.json'), '--shot', shot];
const onSet = (name: string, extra: string[] = []) =>
  run(['--frames', path.join(sets, name), '--px-per-dp', '0.5', ...(extra.includes('--marker') || extra.includes('--shot') ? [] : mark()), ...extra]);
const last = (report: string | null) => (report ?? '').trimEnd().split(/\r?\n/).pop();
const lines = (report: string | null) => (report ?? '').split(/\r?\n/);

describe('the planted sets', () => {
  it('are what they say: greys either side of WCAG\'s 0.1 step, the marker in cell 0,3', () => {
    const g = planted.greys;
    expect(g.hi - g.lo).toBeGreaterThan(0.2);
    expect(g.mid - g.lo).toBeGreaterThanOrEqual(0.1);
    expect(g.mid - g.lo).toBeLessThan(0.15);
    expect(g.sub - g.lo).toBeLessThan(0.1);
    expect(planted.cellPx).toBe(12);
    expect(planted.marker).toMatchObject({ x: 0, y: 36, size: 8 });
  });
});

describe('S7: flashes per 24 dp cell', () => {
  it('a cell at 2 flashes in every 1 s window passes, and the report says how it read the frames', () => {
    const r = onSet('pass-2hz');
    expect({ status: r.status, stderr: r.stderr }).toEqual({ status: 0, stderr: '' });
    expect(r.stdout).toBe(r.report);
    const L = lines(r.report);
    expect(L[0]).toBe('flashTrace (B8-7: QA-068\'s S7 and UI-190), Abyss dark only; the CTA and voice-line regions need the hero (B6) and are not read');
    expect(L).toContain('frames: 240, 0 to 3983.333 ms; held to a 16.667 ms grid (each frame until the next, none dropped)');
    expect(L).toContain('grid: 24 dp cells of 12 px at 0.5 px per dp over 0,0 96x192 px: 128 cells, 1 under the marker left out');
    expect(L).toContain('marker: 0,36 8x8 px, from READY\'s marker probe 0,72 16x16 screen px in shot planted.1, scaled by 0.5; 1 change');
    expect(L).toContain('  worst: 2 in cell 4,8 (dp 96,192 24x24)');
    expect(L).toContain('  over 2: none');
    expect(last(r.report)).toBe('PASS: every cell at most 2 flashes in any 1 s window (worst 2); 1 marker change read');
  });

  it('a cell at 3 flashes fails, named; a 2-flash cell beside it is not listed', () => {
    const r = onSet('fail-3hz');
    expect(r.status).toBe(1);
    const L = lines(r.report);
    expect(L).toContain('  worst: 3 in cell 2,5 (dp 48,120 24x24)');
    expect(L).toContain('  over 2: cell 2,5: 3');
    expect(last(r.report)).toBe('FAIL: 1 cell over 2 flashes in a 1 s window (worst 3, cell 2,5)');
  });

  it('a step of 0.12 is a flash (the definition\'s 0.1, not another threshold); a step of 0.08 is none', () => {
    const low = onSet('fail-3hz-low');
    expect(low.status).toBe(1);
    expect(lines(low.report)).toContain('  over 2: cell 2,5: 3');
    const sub = onSet('pass-3hz-sub');
    expect(sub.status).toBe(0);
    expect(lines(sub.report)).toContain('  worst: 0 in cell 0,0 (dp 0,0 24x24)');
  });

  it('screenrecord\'s variable frame rate: a frame only on a change still shows the 3 flashes', () => {
    const r = onSet('fail-vfr');
    expect(r.status).toBe(1);
    const L = lines(r.report);
    expect(L).toContain('frames: 32, 0 to 3833.333 ms; held to a 83.333 ms grid (each frame until the next, none dropped)');
    expect(L).toContain('  worst: 3 in cell 2,5 (dp 48,120 24x24)');
    expect(L).toContain('  over 2: cell 2,5: 3');
  });

  it('the region narrows the grid: a region without the flickering cell passes', () => {
    const r = onSet('fail-3hz', ['--region', '0,0,24,192']);
    expect(lines(r.report)).toContain('grid: 24 dp cells of 12 px at 0.5 px per dp over 0,0 24x192 px: 32 cells, 1 under the marker left out');
    expect(r.status).toBe(0);
  });

  it('counts with flashCount.ts\'s definition, imported: no flash threshold or window of its own', () => {
    const src = fs.readFileSync(SCRIPT, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
    expect(src).toMatch(/import \{[^}]*\bworstFlashesPerSecond\b[^}]*\} from '\.\.\/\.\.\/\.\.\/src\/design\/v2\/field\/flashCount\.ts'/);
    expect(src).toMatch(/import \{[^}]*\brelY\b[^}]*\} from '\.\.\/\.\.\/\.\.\/src\/design\/v2\/field\/flashCount\.ts'/);
    expect(src).not.toMatch(/0\.04045|12\.92|0\.2126|0\.7152|0\.0722|>=\s*0\.1\b|<\s*0\.8\b|>\s*1000\b/);
  });
});

describe('UI-190: latency from the marker\'s change to the first changed field cell', () => {
  it('2 frames after the first change, 0 after the second; the marker\'s own cell never counts', () => {
    const r = onSet('latency');
    expect(r.status).toBe(0);
    const L = lines(r.report);
    expect(L).toContain('marker: 0,36 8x8 px, from READY\'s marker probe 0,72 16x16 screen px in shot planted.1, scaled by 0.5; 2 changes');
    expect(L).toContain('  change 1 at frame 100 (1666.667 ms), quiet 1650 ms before: first field change at frame 102 (1700 ms), 2 frames, 33.333 ms, cell 5,10');
    expect(L).toContain('  change 2 at frame 200 (3333.333 ms), quiet 1616.667 ms before: first field change at frame 200 (3333.333 ms), 0 frames, 0 ms, cell 5,10');
    expect(L).toContain('  after at least 1000 ms quiet: 2 changes, 0 to 2 frames, 0 to 33.333 ms');
  });

  it('a recording where the marker never changes is not a storm recording: FAIL', () => {
    const r = onSet('static');
    expect(r.status).toBe(1);
    expect(lines(r.report)).toContain('  no marker change: nothing to measure from');
    expect(last(r.report)).toBe('FAIL: the marker never changed, so this is not a storm recording or the marker rect is wrong');
  });

  it('the marker rect can be given in frame px (READY\'s marker probe, scaled to the recording)', () => {
    const r = onSet('latency', ['--marker', '0,36,8,8']);
    expect(lines(r.report)).toContain('marker: 0,36 8x8 px, from --marker; 2 changes');
    const elsewhere = onSet('latency', ['--marker', '84,0,8,8']);
    expect(lines(elsewhere.report)).toContain('marker: 84,0 8x8 px, from --marker; 0 changes');
  });

  it('READY decides where the marker is, never the dp constant: a probe READY put on the right edge is read there', () => {
    const r = onSet('latency', mark('planted-right'));
    expect(lines(r.report)).toContain('marker: 88,36 8x8 px, from READY\'s marker probe 176,72 16x16 screen px in shot planted-right.1, scaled by 0.5; 0 changes');
    expect(r.status).toBe(1);
    const src = fs.readFileSync(SCRIPT, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
    expect(src).not.toMatch(/STORM_MARKER_DP/);
  });

  it('no marker source, both, a shot not in the manifest, a marker READY left out, a stage scaled unequally: refused', () => {
    const base = ['--frames', path.join(sets, 'latency'), '--px-per-dp', '0.5'];
    const no = (args: string[], why: RegExp) => {
      const r = run(args);
      expect([r.status, r.report]).toEqual([2, null]);
      expect(r.stderr).toMatch(why);
    };
    no(base, /give --manifest <manifest\.json> --shot <id> \(READY's marker probe\) or --marker x,y,w,h, exactly one/);
    no([...base, ...mark(), '--marker', '0,36,8,8'], /exactly one/);
    no([...base, '--manifest', path.join(sets, 'manifest.json')], /--manifest needs --shot/);
    no([...base, ...mark('nowhere')], /manifest\.rows has no row for shot "nowhere"/);
    no([...base, ...mark('planted-under-bars')], /READY's marker probe in shot planted-under-bars\.1 was left out of the capture: partly under the system bars/);
    no([...base, ...mark('planted-squashed')], /scales the 192x300 px stage to the 96x192 px frames unequally \(0\.5 by 0\.64\)/);
  });
});

describe('inputs it cannot use: exit 2, no report', () => {
  const copySet = (name: string) => {
    const dir = fs.mkdtempSync(path.join(root, `${name}-`));
    for (const f of fs.readdirSync(path.join(sets, name))) fs.copyFileSync(path.join(sets, name, f), path.join(dir, f));
    return dir;
  };
  const refused = (r: ReturnType<typeof run>, why: RegExp) => {
    expect(r.status).toBe(2);
    expect(r.report).toBeNull();
    expect(r.stderr).toMatch(why);
  };

  it('no frames.json, a timestamp that does not rise, a frame of another size, a file that is not beside it', () => {
    const none = copySet('pass-2hz');
    fs.rmSync(path.join(none, 'frames.json'));
    refused(run(['--frames', none, '--px-per-dp', '0.5', ...mark()]), /frames\.json/);
    const back = copySet('pass-2hz');
    const j = JSON.parse(fs.readFileSync(path.join(back, 'frames.json'), 'utf8'));
    j.frames[5].tMs = j.frames[4].tMs;
    fs.writeFileSync(path.join(back, 'frames.json'), JSON.stringify(j));
    refused(run(['--frames', back, '--px-per-dp', '0.5', ...mark()]), /frames\[5\]\.tMs .*must rise/);
    const size = copySet('pass-2hz');
    fs.copyFileSync(path.join(sets, 'odd-size.png'), path.join(size, '00007.png'));
    refused(run(['--frames', size, '--px-per-dp', '0.5', ...mark()]), /frames\[7\] .*48x48.*96x192/);
    const away = copySet('pass-2hz');
    const k = JSON.parse(fs.readFileSync(path.join(away, 'frames.json'), 'utf8'));
    k.frames[3].file = '../00003.png';
    fs.writeFileSync(path.join(away, 'frames.json'), JSON.stringify(k));
    refused(run(['--frames', away, '--px-per-dp', '0.5', ...mark()]), /frames\[3\]\.file .*beside frames\.json/);
  });

  it('a missing or bad --px-per-dp, both inputs or neither, an unknown option', () => {
    // Without a run to derive it from (--marker), --px-per-dp is required.
    refused(run(['--frames', path.join(sets, 'pass-2hz'), '--marker', '0,36,8,8']), /--px-per-dp/);
    refused(run(['--frames', path.join(sets, 'pass-2hz'), '--px-per-dp', '0', ...mark()]), /--px-per-dp/);
    refused(run(['--px-per-dp', '0.5', ...mark()]), /--frames .* or --mp4/);
    refused(run(['--frames', path.join(sets, 'pass-2hz'), '--mp4', 'x.mp4', '--px-per-dp', '0.5', ...mark()]), /--frames .* or --mp4/);
    refused(run(['--frames', path.join(sets, 'pass-2hz'), '--px-per-dp', '0.5', ...mark(), '--loud']), /unknown option --loud/);
  });

  it('never overwrites a report', () => {
    const out = path.join(root, 'earlier.txt');
    fs.writeFileSync(out, 'an earlier report\n');
    const r = run(['--frames', path.join(sets, 'pass-2hz'), '--px-per-dp', '0.5', ...mark()], out);
    expect(r.status).toBe(2);
    expect(fs.readFileSync(out, 'utf8')).toBe('an earlier report\n');
    expect(r.stderr).toMatch(/refusing to overwrite/);
  });
});

describe('the mp4 route: screenrecord\'s mp4 through an ffmpeg the caller names', () => {
  it('no --ffmpeg: refused, naming the missing tool and that installing one is the owner\'s call', () => {
    const r = run(['--mp4', path.join(root, 'storm.mp4'), '--size', '540x1170', '--px-per-dp', '1.40625', '--marker', '0,0,2,2']);
    expect(r.status).toBe(2);
    expect(r.report).toBeNull();
    expect(r.stderr).toMatch(/--mp4 needs --ffmpeg <path>: no ffmpeg was given/);
    expect(r.stderr).toMatch(/owner/);
  });

  it('an --ffmpeg path that does not exist, or no --size: refused, naming it', () => {
    const missing = path.join(root, 'no-such-ffmpeg.exe');
    const r = run(['--mp4', path.join(root, 'storm.mp4'), '--ffmpeg', missing, '--size', '540x1170', '--px-per-dp', '1.40625', '--marker', '0,0,2,2']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain(`ffmpeg not found at ${missing}`);
    const s = run(['--mp4', path.join(root, 'storm.mp4'), '--ffmpeg', process.execPath, '--px-per-dp', '1.40625', '--marker', '0,0,2,2']);
    expect(s.status).toBe(2);
    expect(s.stderr).toMatch(/--mp4 needs --size <width>x<height>/);
  });

  // The adapter's two halves that do not need an ffmpeg: the command it runs, and its reading of ffmpeg's own output
  // (showinfo's per-frame lines on stderr; rgba frames back to back on stdout). The format is ffmpeg's documented one;
  // the first real run is the closing evidence (no ffmpeg on this PC, and installing one is the owner's call).
  const call = (expr: string) => {
    const code = `import(${JSON.stringify(`file://${SCRIPT.replace(/\\/g, '/')}`)}).then((m) => { process.stdout.write(JSON.stringify(${expr})); })`;
    const p = spawnSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', code], { cwd: APP, encoding: 'utf8' });
    if (p.status !== 0) throw new Error(p.stderr);
    return JSON.parse(p.stdout);
  };

  it('the command: every frame as decoded (passthrough), showinfo for its time, rgba to stdout', () => {
    expect(call("m.ffmpegArgs('C:/r/storm.mp4')")).toEqual([
      '-hide_banner', '-nostdin', '-loglevel', 'info', '-i', 'C:/r/storm.mp4', '-map', '0:v:0', '-fps_mode', 'passthrough',
      '-vf', 'showinfo', '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1',
    ]);
  });

  it('showinfo\'s lines: frame index, time in ms and size; any other line is ignored', () => {
    const text = [
      'Input #0, mov,mp4,m4a,3gp,3g2,mj2, from \'storm.mp4\':',
      '[Parsed_showinfo_0 @ 0000020c] config in time_base: 1/90000, frame_rate: 60/1',
      '[Parsed_showinfo_0 @ 0000020c] n:   0 pts:      0 pts_time:0       duration:   1500 duration_time:0.0166667 fmt:yuv420p cl:left sar:1/1 s:540x1170 i:P iskey:1 type:I checksum:1A2B3C4D',
      '[Parsed_showinfo_0 @ 0000020c] n:   1 pts:   1502 pts_time:0.0166889 pos:  4096 fmt:yuv420p sar:1/1 s:540x1170 i:P iskey:0 type:P checksum:00000000',
      '[Parsed_showinfo_0 @ 0000020c] color_range:tv color_space:bt709',
      '[Parsed_showinfo_0 @ 0000020c] n:   2 pts:   4500 pts_time:0.05    duration:   1500 fmt:yuv420p sar:1/1 s:540x1170 i:P iskey:0 type:P',
    ].join('\n');
    expect(call(`m.parseShowinfo(${JSON.stringify(text)})`)).toEqual([
      { n: 0, tMs: 0, width: 540, height: 1170 },
      { n: 1, tMs: 16.6889, width: 540, height: 1170 },
      { n: 2, tMs: 50, width: 540, height: 1170 },
    ]);
  });

  it('stdout split into whole frames, a short tail refused', () => {
    expect(call('m.splitRawFrames([Buffer.alloc(10, 1), Buffer.alloc(14, 2)], 2, 1).map((f) => Array.from(f))')).toEqual([
      [1, 1, 1, 1, 1, 1, 1, 1], [1, 1, 2, 2, 2, 2, 2, 2], [2, 2, 2, 2, 2, 2, 2, 2],
    ]);
    expect(() => call('m.splitRawFrames([Buffer.alloc(9)], 2, 1)')).toThrow(/9 bytes is not a whole number of 2x1 rgba frames/);
  });
});

// RA-47 (the resilience audit of B8 at 16665fb, S2): nothing bound flashTrace's inputs to the run, so a failed run's mp4,
// another shot's or run's mp4, another size, or the device's px per dp on a half-size recording (cells twice as big, which
// averages flashes away) could read as PASS. scripts/lab/reports/lib/recordBinding.mjs's recordingProblems checks a
// recording against the manifest; with --manifest, flashTrace refuses anything it names, and derives the px per dp from
// the run (Android's float density × frame width ÷ stage width), --px-per-dp only an override that must agree.
describe('RA-47: the recording is bound to the run', () => {
  const BIND = path.join(APP, 'scripts/lab/reports/lib/recordBinding.mjs');
  const bind = (file: string, input: Record<string, unknown>) => {
    const code = `import(${JSON.stringify(`file://${BIND.replace(/\\/g, '/')}`)}).then((m) => {
      const manifest = JSON.parse(require('node:fs').readFileSync(${JSON.stringify(path.join(sets, file))}, 'utf8'));
      process.stdout.write(JSON.stringify({ problems: m.recordingProblems(manifest, ${JSON.stringify(input)}), pxPerDp: m.recordingPxPerDp(manifest, ${JSON.stringify(input.shot)}, ${JSON.stringify(input.size)}) }));
    })`;
    const p = spawnSync(process.execPath, ['--no-warnings', '--input-type=commonjs', '-e', code], { cwd: APP, encoding: 'utf8' });
    if (p.status !== 0) throw new Error(p.stderr);
    return JSON.parse(p.stdout) as { problems: string[]; pxPerDp: number | null };
  };
  const SIZE = { width: 96, height: 192 };
  const bound = () => ({ shot: 'planted', mp4Sha256: planted.mp4Sha256, size: SIZE, pxPerDp: 0.5 });

  it('the bound recording: no problem, and the run says 0.5 px per dp (density 160 → 1, × 96 ÷ stage 192)', () => {
    expect(bind('manifest.json', bound())).toEqual({ problems: [], pxPerDp: 0.5 });
    expect(bind('manifest.json', { ...bound(), pxPerDp: undefined }).problems).toEqual([]);
  });

  it.each([
    ['a failed run', 'manifest-failed.json', {}, /^manifest\.outcome is "failed", not "passed": planted failure$/],
    ['another mp4', 'manifest.json', { mp4Sha256: 'f'.repeat(64) }, /^manifest\.records\[0\]\.sha256 [0-9a-f]{64} is not the recording's f{64}$/],
    ['another size', 'manifest.json', { size: { width: 540, height: 1170 } }, /^manifest\.records\[0\]\.size 96x192 is not the recording's 540x1170$/],
    ['the same width, another height', 'manifest.json', { size: { width: 96, height: 200 } }, /^manifest\.records\[0\]\.size 96x192 is not the recording's 96x200$/],
    ['the device\'s px per dp on a half-size recording', 'manifest.json', { pxPerDp: 1 },
      /^px per dp 1 is not the recording's 0\.5: manifest\.rows\[0\]\.device\.density 160 dpi is Android's density 1, × 96 px frames ÷ manifest\.rows\[0\]\.stage\.width 192$/],
    ['a shot with no record', 'manifest.json', { shot: 'planted-norecord' }, /^manifest\.records has no record for shot "planted-norecord"$/],
    ['a shot with no row', 'manifest.json', { shot: 'nowhere' }, /^manifest\.rows has no row for shot "nowhere"$/],
  ])('%s: refused, naming the field', (_why, file, change, why) => {
    const { problems } = bind(file as string, { ...bound(), ...(change as object) });
    // A shot with no row has no record either: both are named, the row first.
    expect(problems).toHaveLength((change as { shot?: string }).shot === 'nowhere' ? 2 : 1);
    expect(problems[0]).toMatch(why as RegExp);
  });

  // UI-240: the top level is validateManifest's before any field of it is read.
  it('UI-240: a manifest whose top level is not the harness\'s is refused before it is read, naming the field', () => {
    const m = JSON.parse(fs.readFileSync(path.join(sets, 'manifest.json'), 'utf8'));
    delete m.stamp;
    fs.writeFileSync(path.join(sets, 'manifest-nostamp.json'), JSON.stringify(m));
    expect(bind('manifest-nostamp.json', bound()).problems).toEqual(['manifest.stamp is required']);
    fs.writeFileSync(path.join(sets, 'manifest-bare.json'), JSON.stringify({ outcome: 'passed', rows: m.rows, records: m.records }));
    expect(bind('manifest-bare.json', bound()).problems).toContain('manifest.commit is required');
  });

  const refusedRun = (args: string[], why: RegExp) => {
    const r = run(args);
    expect([r.status, r.report]).toEqual([2, null]);
    expect(r.stderr).toMatch(why);
  };
  const frames = (name = 'pass-2hz') => ['--frames', path.join(sets, name)];

  it('flashTrace on the bound recording: PASS, the run named, the px per dp derived when --px-per-dp is not given', () => {
    const r = run([...frames(), ...mark()]);
    expect(r.status).toBe(0);
    const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(sets, 'manifest.json'))).digest('hex');
    expect(lines(r.report)).toContain(`run: manifest ${path.join(sets, 'manifest.json')} (sha256 ${sha}), outcome passed, shot planted.1, record planted.mp4 sha256 ${planted.mp4Sha256} 96x192 px; 0.5 px per dp from the run`);
    expect(lines(r.report)).toContain('grid: 24 dp cells of 12 px at 0.5 px per dp over 0,0 96x192 px: 128 cells, 1 under the marker left out');
  });

  it('flashTrace refuses a failed run, another mp4, another size, the device\'s px per dp, no record: exit 2, naming the field', () => {
    refusedRun([...frames(), '--manifest', path.join(sets, 'manifest-failed.json'), '--shot', 'planted'], /manifest\.outcome is "failed"/);
    refusedRun([...frames(), ...mark('planted-other')], /manifest\.records\[4\]\.sha256 .* is not the recording's/);
    refusedRun([...frames(), ...mark('planted-size')], /manifest\.records\[5\]\.size 540x1170 is not the recording's 96x192/);
    refusedRun([...frames(), ...mark(), '--px-per-dp', '1'], /px per dp 1 is not the recording's 0\.5/);
    refusedRun([...frames(), ...mark('planted-norecord')], /manifest\.records has no record for shot "planted-norecord"/);
  });

  it('frames.json must name the mp4 it was decoded from, and its frames must be that size, once a run binds them', () => {
    const dir = fs.mkdtempSync(path.join(root, 'nosource-'));
    for (const f of fs.readdirSync(path.join(sets, 'pass-2hz'))) fs.copyFileSync(path.join(sets, 'pass-2hz', f), path.join(dir, f));
    const j = JSON.parse(fs.readFileSync(path.join(dir, 'frames.json'), 'utf8'));
    fs.writeFileSync(path.join(dir, 'frames.json'), JSON.stringify({ frames: j.frames }));
    refusedRun(['--frames', dir, ...mark()], /frames\.json names no source \{ mp4Sha256, size \}: the run cannot bind its frames/);
    fs.writeFileSync(path.join(dir, 'frames.json'), JSON.stringify({ ...j, source: { ...j.source, size: { width: 48, height: 96 } } }));
    refusedRun(['--frames', dir, ...mark()], /manifest\.records\[0\]\.size 96x192 is not the recording's 48x96/);
  });

  it('the mp4 route binds before ffmpeg runs: another mp4 is refused, the bound one reaches the decoder', () => {
    const other = path.join(root, 'other.mp4');
    fs.writeFileSync(other, 'not the planted recording');
    refusedRun(['--mp4', other, '--ffmpeg', process.execPath, ...mark()], /manifest\.records\[0\]\.sha256 .* is not the recording's/);
    const same = path.join(root, 'planted.mp4');
    fs.writeFileSync(same, 'the planted storm recording');
    // node standing in for ffmpeg cannot decode, so the run fails at the decoder: the binding let it through, at the record's size.
    refusedRun(['--mp4', same, '--ffmpeg', process.execPath, ...mark()], /ffmpeg exited/);
  });
});

describe('the report itself', () => {
  it('names its input by one sha256 over frames.json and every PNG in its order: two sets with the same list differ', () => {
    const shaOf = (name: string) => {
      const dir = path.join(sets, name);
      const h = crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, 'frames.json')));
      for (const f of JSON.parse(fs.readFileSync(path.join(dir, 'frames.json'), 'utf8')).frames) h.update(fs.readFileSync(path.join(dir, f.file)));
      return h.digest('hex');
    };
    const r = onSet('pass-2hz');
    expect(lines(r.report)[1]).toBe(`source: frames ${path.join(sets, 'pass-2hz')} (frames.json and its 240 PNGs, sha256 ${shaOf('pass-2hz')})`);
    expect(fs.readFileSync(path.join(sets, 'pass-2hz', 'frames.json'))).toEqual(fs.readFileSync(path.join(sets, 'latency', 'frames.json')));
    expect(lines(onSet('latency').report)[1]).toContain(`sha256 ${shaOf('latency')}`);
    expect(shaOf('latency')).not.toBe(shaOf('pass-2hz'));
  });
});
