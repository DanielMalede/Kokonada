/// <reference types="node" />
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';

// HX-6 (CMP-099), CI guard: the Google sign-in images ship EXACTLY as Google published them.
// assets/brand/google/README.md records, per shipped file, the archive path it came from and its
// SHA-256. This suite recomputes every hash from the bytes on disk, so an edited, re-exported,
// recompressed or swapped file — or a file nobody recorded — fails CI.

const DIR = path.resolve(__dirname, '../../../assets/brand/google');
const README = path.join(DIR, 'README.md');

const ROW = /^\| `([^`]+)` \| `([^`]+)` \| `([0-9a-f]{64})` \|$/;

function readme(): string {
  return fs.readFileSync(README, 'utf8');
}
function rows(): Array<{ file: string; archivePath: string; sha256: string }> {
  return readme()
    .split(/\r?\n/)
    .map((line) => ROW.exec(line.trim()))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ file: m[1], archivePath: m[2], sha256: m[3] }));
}
const sha256 = (file: string) => crypto.createHash('sha256').update(fs.readFileSync(path.join(DIR, file))).digest('hex');
// PNG IHDR: width and height are big-endian u32 at bytes 16 and 20.
const pngSize = (file: string) => {
  const b = fs.readFileSync(path.join(DIR, file));
  expect(b.subarray(1, 4).toString('latin1')).toBe('PNG');
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
};

const SHIPPED = [
  'google_signin_pill_light.png', 'google_signin_pill_light@2x.png', 'google_signin_pill_light@3x.png',
  'google_signin_pill_dark.png', 'google_signin_pill_dark@2x.png', 'google_signin_pill_dark@3x.png',
];

describe('assets/brand/google — the README is the ledger, and the bytes match it', () => {
  it('records exactly the six shipped images, one row each', () => {
    expect(rows().map((r) => r.file).sort()).toEqual([...SHIPPED].sort());
  });

  it('every file in the folder is recorded (no unlisted image can ride along)', () => {
    const onDisk = fs.readdirSync(DIR).filter((f) => f !== 'README.md').sort();
    expect(onDisk).toEqual(rows().map((r) => r.file).sort());
  });

  it.each(SHIPPED)('%s hashes to the SHA-256 recorded in the README', (file) => {
    const row = rows().find((r) => r.file === file);
    expect(row).toBeDefined();
    expect(sha256(file)).toBe(row!.sha256);
  });

  it('each file came from the Android + Web, Show text=Yes, Pill set, in its own theme and density', () => {
    for (const { file, archivePath } of rows()) {
      const theme = file.includes('_dark') ? 'Dark' : 'Light';
      const density = /@([23])x\.png$/.exec(file)?.[1];
      const folder = `Android + Web/PNG @${density ?? '1'}x/${theme}/`;
      const name = `Theme=${theme}, Show text=Yes, Shape=Pill, Platform=Android+Web${density ? `@${density}x` : ''}.png`;
      expect(archivePath).toBe(folder + name);
    }
  });

  it('records the archive URL, its SHA-256, the download date and the source page', () => {
    const text = readme();
    expect(text).toContain('https://developers.google.com/static/identity/images/signin-assets.zip');
    expect(text).toMatch(/Archive SHA-256:\*\* `[0-9a-f]{64}`/);
    expect(text).toMatch(/Downloaded:\*\* 20\d\d-\d\d-\d\d/);
    expect(text).toContain('https://developers.google.com/identity/branding-guidelines');
  });

  it('records the words drawn on the image', () => {
    expect(readme()).toMatch(/Words drawn:\*\* "[^"]+"/);
  });
});

describe('assets/brand/google — the densities are true multiples of one image', () => {
  it.each(['light', 'dark'])('the %s @2x and @3x files are exactly 2x and 3x the @1x file', (theme) => {
    const one = pngSize(`google_signin_pill_${theme}.png`);
    expect(pngSize(`google_signin_pill_${theme}@2x.png`)).toEqual({ w: one.w * 2, h: one.h * 2 });
    expect(pngSize(`google_signin_pill_${theme}@3x.png`)).toEqual({ w: one.w * 3, h: one.h * 3 });
  });

  it('both themes share one intrinsic size (so one layout fits either face)', () => {
    expect(pngSize('google_signin_pill_light.png')).toEqual(pngSize('google_signin_pill_dark.png'));
  });
});
