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

// The six SHA-256 values of Google's files as downloaded on 2026-09-30, pinned HERE as well as in the
// README (resilience, HX-6 round 1). Comparing the files only to the README would let a swapped
// file ride through with a matching README edit; both must now also equal this independent record.
const PINNED_SHA256: Record<string, string> = {
  'google_signin_pill_light.png': '59f49a157cd98021d0b4e443f2decbee986a684f330897e378d8ab3769d06253',
  'google_signin_pill_light@2x.png': '86c7955ee72f3635dc4e1415ac6e10035ca0bb1319245c8e1b441ce1cb5f6981',
  'google_signin_pill_light@3x.png': '1785e04475553fcec1b63524af33ebfde36ff422008c371589a014c03bf224a4',
  'google_signin_pill_dark.png': '23b2cceb7831bb576ad2738119191d2fd41ea650265f2034e4ef4cceda7ca904',
  'google_signin_pill_dark@2x.png': 'e0289ad5a31e65af63e385a89457cf3b2405d3a6dda2df6119778b9afdb74bae',
  'google_signin_pill_dark@3x.png': 'c2170246da7db96313062aba5e8e39b15431b2e2fd202c563a81c498f8b2b1f8',
};
const SHIPPED = Object.keys(PINNED_SHA256);

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

  it.each(SHIPPED)('%s hashes to the value pinned in this test (independent of the README)', (file) => {
    expect(sha256(file)).toBe(PINNED_SHA256[file]);
  });

  it('the README records exactly the pinned values (a README edit alone cannot re-bless a file)', () => {
    expect(Object.fromEntries(rows().map((r) => [r.file, r.sha256]))).toEqual(PINNED_SHA256);
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

  // Compliance, HX-6 round 1: why Google's Dark file is correct on the dark face. The guidelines'
  // colour rules and Do/Don't lists allow light, dark and neutral modes; "on a white background"
  // (rule 2) governs a G you build yourself, not Google's own Dark theme.
  it('records the colour-mode rules that make the Dark file correct on the dark face', () => {
    const text = readme();
    expect(text).toContain('"The button must always include the standard color for the Google "G"."');
    expect(text).toContain('"Use the Google brand color for Google icon for dark, light, and neutral modes."');
    expect(text).toContain('"Choose the button in the right color mode for accessibility and equal prominence."');
    expect(text).toContain('other than light, dark, or neutral');
    expect(text).toContain('The Dark file is Google\'s own Dark theme, unmodified; rule 2 governs a G you build yourself.');
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
