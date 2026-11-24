/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';

// FONT LICENCE GUARD (HX-8 · CMP-120 · UI-013). A display face shipped under a licence that forbids
// redistributing the font file, beside a file named OFL.txt that held that other licence, and a README
// that called it OFL. Nothing checked any of it. These scans pin the rule the repository now keeps:
//   1. a font is here only with its own family's licence beside it: OFL-<family>.txt, the real SIL Open
//      Font License, carrying the copyright notice the font itself carries (X4, CMP-117);
//   2. a file that presents itself as the OFL is the OFL;
//   3. a font carried inside a document (a base64 data: URI) has the real OFL text beside it, because it
//      is the same bytes (its family is not read from the payload);
//   4. the app names no face it does not ship, and loads no font file the repository does not hold;
//   5. the Xcode project bundles nothing that is not on disk (iOS cannot be built here, so this is
//      the only evidence the project still resolves after files are removed);
//   6. each font file in the app is its upstream file byte for byte and each licence its upstream text
//      (CMP-118, CMP-124), and each font file is the face its file name says (UI-072);
//   7. each font file in the app has a glyph for every code point CMP-122 names.
// The enumerator is `git ls-files` from the repository root, the attribution guard's idiom: "tracked"
// is the boundary that reaches a public remote and a build, and it is the same on every machine. So a
// new file is seen only once it is staged: run this after `git add`, before the commit.

const REPO = path.resolve(__dirname, '../../../../..');
const APP = 'mobile/KokonadaHealth/';
const SELF = `${APP}src/design/__tests__/fontLicence.test.ts`;

const TRACKED = execFileSync('git', ['ls-files', '-z'], { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\0')
  .filter(Boolean)
  .filter((f) => fs.existsSync(path.join(REPO, f)));

const cache = new Map<string, Buffer>();
const bytes = (f: string): Buffer => {
  let b = cache.get(f);
  if (!b) { b = fs.readFileSync(path.join(REPO, f)); cache.set(f, b); }
  return b;
};
// git's own binary heuristic: a NUL in the first 8000 bytes.
const isText = (b: Buffer) => !b.subarray(0, 8000).includes(0);
const text = (f: string) => bytes(f).toString('utf8');
const TEXT_FILES = TRACKED.filter((f) => isText(bytes(f)));

// ---- the checks, as pure functions so the fixtures below can prove each one bites ----------------

const FONT_EXT = /\.(?:otf|ttf|ttc|woff2?|eot)$/i;
// sfnt/OpenType-CFF/TrueType-Apple/collection/WOFF/WOFF2 signatures, so a renamed font is still a font.
const FONT_MAGIC = ['OTTO', '\u0000\u0001\u0000\u0000', 'true', 'ttcf', 'wOFF', 'wOF2'].map((m) => Buffer.from(m, 'latin1'));
const isFontFile = (name: string, b: Buffer) =>
  FONT_EXT.test(name) || FONT_MAGIC.some((m) => b.length >= 4 && b.subarray(0, 4).equals(m));

// A font inside a text file: a data: URI whose media type names a font, or whose base64 payload opens
// with a font signature (the first five characters encode exactly the first four bytes), so relabelling
// the media type does not hide it.
const FONT_MEDIA_URI = /data:(?:font\/|application\/(?:x-)?font|application\/vnd\.ms-fontobject)[^,]*,/i;
const FONT_PAYLOAD_URI = /data:[^,]*;base64,(?:T1RUT|AAEAA|dHJ1Z|dHRjZ|d09GR|d09GM)/;
const embedsFont = (s: string) => FONT_MEDIA_URI.test(s) || FONT_PAYLOAD_URI.test(s);

// The real SIL OFL 1.1: its title, its grant and its copyleft clause. A text that also calls itself an
// end-user licence agreement is another licence wearing the name, which is the defect this closes.
const OFL_MUST = [
  'SIL OPEN FONT LICENSE Version 1.1',
  'PERMISSION & CONDITIONS',
  'Permission is hereby granted, free of charge, to any person obtaining a copy of the Font Software',
  'must be distributed entirely under this license',
];
const NOT_OFL = /end[\s-]*user\s+licen[cs]e\s+agreement|\bEULA\b/i;
const isRealOfl = (s: string) => {
  const flat = s.replace(/\s+/g, ' ');
  return OFL_MUST.every((p) => flat.includes(p)) && !NOT_OFL.test(flat);
};

const LICENCE_FILE = /^(?:OFL|LICEN[CS]E)[\w.-]*\.txt$/i;
const OFL_NAMED = /^OFL[\w.-]*\.txt$/i;
const dir = (f: string) => path.posix.dirname(f);
const base = (f: string) => path.posix.basename(f);
const hasRealOflBeside = (f: string) =>
  TRACKED.some((g) => dir(g) === dir(f) && LICENCE_FILE.test(base(g)) && isRealOfl(text(g)));

// ---- what a font file says it is: its sfnt tables (UI-069, UI-072) -------------------------------------------------
// A font file is read as the sfnt it is: its table directory, then its name and OS/2 tables. A file this reader cannot
// read (a collection, a WOFF, a truncated file) is refused by every check that must know what it is: the app ships
// single TrueType or OpenType files, the only kind React Native loads from fonts/.

type SfntTable = { readonly offset: number; readonly length: number };
type Sfnt = { readonly bytes: Buffer; readonly tables: ReadonlyMap<string, SfntTable> };

const SFNT_VERSIONS = new Set([0x00010000, 0x4f54544f /* OTTO */, 0x74727565 /* true */]);

function readSfnt(b: Buffer): Sfnt | null {
  if (b.length < 12 || !SFNT_VERSIONS.has(b.readUInt32BE(0))) return null;
  const count = b.readUInt16BE(4);
  if (b.length < 12 + 16 * count) return null;
  const tables = new Map<string, SfntTable>();
  for (let i = 0; i < count; i += 1) {
    const r = 12 + 16 * i;
    const offset = b.readUInt32BE(r + 8);
    const length = b.readUInt32BE(r + 12);
    if (offset + length > b.length) return null;
    tables.set(b.toString('latin1', r, r + 4), { offset, length });
  }
  return { bytes: b, tables };
}

const utf16be = (raw: Buffer) => {
  let s = '';
  for (let k = 0; k + 1 < raw.length; k += 2) s += String.fromCharCode(raw.readUInt16BE(k));
  return s;
};

/** Name `id`: the Windows English (US) record if there is one, else any Unicode record, else a Mac Roman one. */
function nameOf(s: Sfnt, id: number): string | null {
  const t = s.tables.get('name');
  if (!t) return null;
  const b = s.bytes;
  const count = b.readUInt16BE(t.offset + 2);
  const strings = t.offset + b.readUInt16BE(t.offset + 4);
  let best: { rank: number; text: string } | null = null;
  for (let i = 0; i < count; i += 1) {
    const r = t.offset + 6 + 12 * i;
    if (b.readUInt16BE(r + 6) !== id) continue;
    const platform = b.readUInt16BE(r);
    const encoding = b.readUInt16BE(r + 2);
    const unicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (!unicode && !(platform === 1 && encoding === 0)) continue;
    const start = strings + b.readUInt16BE(r + 10);
    const raw = b.subarray(start, start + b.readUInt16BE(r + 8));
    const rank = platform === 3 && b.readUInt16BE(r + 4) === 0x409 ? 0 : unicode ? 1 : 2;
    if (best === null || rank < best.rank) best = { rank, text: unicode ? utf16be(raw) : raw.toString('latin1') };
  }
  return best?.text ?? null;
}

const weightClassOf = (s: Sfnt): number | null => {
  const t = s.tables.get('OS/2');
  return t && t.length >= 6 ? s.bytes.readUInt16BE(t.offset + 4) : null;
};

// React Native on Android looks a family up by file name (fonts/<family>.ttf) and iOS by PostScript name, and the lab
// names each weight as its own family (src/design/lab/fonts.ts): so a file's PostScript name is its file name, and its
// weight class is the weight its style name says. A file renamed to another weight fails here.
const STYLE_WEIGHT: Readonly<Record<string, number>> = {
  Thin: 100, ExtraLight: 200, Light: 300, Regular: 400, Medium: 500, SemiBold: 600, Bold: 700, ExtraBold: 800, Black: 900,
};

/** Why a font file is not the face its file name says, or null when it is. */
function faceMismatch(file: string, b: Buffer): string | null {
  const s = readSfnt(b);
  if (!s) return 'not a TrueType or OpenType file this guard can read';
  const stem = base(file).replace(FONT_EXT, '');
  const postScript = nameOf(s, 6);
  if (postScript !== stem) return `its PostScript name is ${JSON.stringify(postScript)}, not its file name "${stem}"`;
  const hyphen = stem.lastIndexOf('-');
  const style = hyphen < 0 ? '' : stem.slice(hyphen + 1).replace(/Italic$/, '') || 'Regular';
  const expected = STYLE_WEIGHT[style];
  if (expected === undefined) return `"${stem}" names no weight after its hyphen`;
  const weight = weightClassOf(s);
  if (weight !== expected) return `its weight class is ${weight}, not the ${expected} its style ${style} says`;
  return null;
}

// The upstream file each font in the app is, byte for byte (CMP-118: an unmodified file is not a Modified Version, so no
// Reserved Font Name question arises; CMP-124). A font added to the app is pinned here with where it came from; a font
// changed in any way (subset, converted, instanced) no longer matches, and must be named as a Modified Version first.
const HEEBO_UPSTREAM = 'https://github.com/OdedEzer/heebo/blob/76c7d538568d3e6d7f052a12c5675c84430df25f/fonts/ttf';
const GOOGLE_FONTS = 'https://github.com/google/fonts/blob/3f24ccf123f3c50f72b96d3e15704fe629d2df5d/ofl';
const UPSTREAM_FONTS: Readonly<Record<string, { readonly sha256: string; readonly from: string }>> = {
  [`${APP}assets/fonts/Heebo-Light.ttf`]: { sha256: '4766c9d727f9a4fe0c6bdc4032a82eaa2480ca8f3e516095ed8ba14dc6c0aaf7', from: `${HEEBO_UPSTREAM}/Heebo-Light.ttf` },
  [`${APP}assets/fonts/Heebo-Regular.ttf`]: { sha256: 'e9dc1958e6a5aec129ee79f01e9cfb442680b73bf6c72964137daa581a3afd62', from: `${HEEBO_UPSTREAM}/Heebo-Regular.ttf` },
  [`${APP}assets/fonts/Heebo-Medium.ttf`]: { sha256: 'cba4ce1a4c8ebaf36d0ac34d1941bc4d8a0117e343fac28c46a01635a08a92f1', from: `${HEEBO_UPSTREAM}/Heebo-Medium.ttf` },
  [`${APP}assets/fonts/Heebo-SemiBold.ttf`]: { sha256: 'c1ccdb23b62a503aab7277510f994e665e40eea062305f8e87a7616072aadcba', from: `${HEEBO_UPSTREAM}/Heebo-SemiBold.ttf` },
  [`${APP}assets/fonts/Bellefair-Regular.ttf`]: { sha256: '5c0cd4d526e6dfcb189106af6b5e6ec99a54efb6d458dfd61626ce6dc0f03026', from: `${GOOGLE_FONTS}/bellefair/Bellefair-Regular.ttf` },
};
const sha256 = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const APP_FONTS = TRACKED.filter((f) => f.startsWith(APP) && isFontFile(f, bytes(f)));

// ---- each font's own licence (X4, CMP-117) ---------------------------------------------------------------------------
const flat = (s: string) => s.replace(/\s+/g, ' ').trim();

/**
 * Why a font file has not its own family's licence beside it, or null when it has. `beside` reads a file in the font's
 * folder (null when there is none). The family is the typographic family (name 16), else the family (name 1); its licence
 * is OFL-<family, without spaces>.txt, the real OFL, carrying the copyright notice the font itself carries (name 0), as
 * OFL condition 2 asks of every copy.
 */
function licenceMismatch(b: Buffer, beside: (name: string) => string | null): string | null {
  const s = readSfnt(b);
  if (!s) return 'not a TrueType or OpenType file this guard can read, so its family cannot be known';
  const family = nameOf(s, 16) ?? nameOf(s, 1);
  if (!family) return 'it names no family (name 16 or 1)';
  const licence = `OFL-${family.replace(/\s+/g, '')}.txt`;
  const body = beside(licence);
  if (body === null) return `no ${licence} beside it`;
  if (!isRealOfl(body)) return `${licence} is not the SIL Open Font License 1.1`;
  const notice = nameOf(s, 0);
  if (!notice) return 'it carries no copyright notice (name 0) for its licence to repeat';
  if (!flat(body).includes(flat(notice))) return `${licence} does not carry the font's copyright notice: ${notice}`;
  return null;
}

// Each licence in the app is its upstream OFL.txt (CMP-124), pinned by the SHA-256 of its text with LF line endings: the
// repository stores text as LF (.gitattributes), and Heebo's upstream OFL.txt has CRLF.
const UPSTREAM_LICENCES: Readonly<Record<string, { readonly sha256: string; readonly from: string }>> = {
  [`${APP}assets/fonts/OFL-Heebo.txt`]: { sha256: '30b4273e07751578fc7e0e01fd2fc2d46ea5bdf65fc7cc58da854dca541da8dd', from: `${GOOGLE_FONTS}/heebo/OFL.txt` },
  [`${APP}assets/fonts/OFL-Bellefair.txt`]: { sha256: '2348c4852e6322105d130aa2addbe24c962e330094ad6dfbfd9fbd2281d76b0b', from: `${GOOGLE_FONTS}/bellefair/OFL.txt` },
};

// ---- what a font file can draw: its cmap (CMP-122) -------------------------------------------------------------------

/** The glyph a code point maps to (0: none) in the font's Unicode cmap, format 12 before format 4; null without one. */
function cmapOf(s: Sfnt): ((cp: number) => number) | null {
  const t = s.tables.get('cmap');
  if (!t) return null;
  const b = s.bytes;
  const subtables = Array.from({ length: b.readUInt16BE(t.offset + 2) }, (_, i) => {
    const r = t.offset + 4 + 8 * i;
    const at = t.offset + b.readUInt32BE(r + 4);
    return { platform: b.readUInt16BE(r), encoding: b.readUInt16BE(r + 2), at, format: b.readUInt16BE(at) };
  });
  const isUnicode = (x: { platform: number; encoding: number }, full: boolean) =>
    x.platform === 0 || (x.platform === 3 && x.encoding === (full ? 10 : 1));
  const f12 = subtables.find((x) => x.format === 12 && isUnicode(x, true));
  if (f12) {
    const groups = b.readUInt32BE(f12.at + 12);
    return (cp) => {
      for (let i = 0; i < groups; i += 1) {
        const r = f12.at + 16 + 12 * i;
        const start = b.readUInt32BE(r);
        if (cp >= start && cp <= b.readUInt32BE(r + 4)) return b.readUInt32BE(r + 8) + (cp - start);
      }
      return 0;
    };
  }
  const f4 = subtables.find((x) => x.format === 4 && isUnicode(x, false));
  if (!f4) return null;
  const segments = b.readUInt16BE(f4.at + 6) / 2;
  const ends = f4.at + 14;
  const starts = ends + 2 * segments + 2;
  const deltas = starts + 2 * segments;
  const rangeOffsets = deltas + 2 * segments;
  return (cp) => {
    if (cp > 0xffff) return 0;
    for (let i = 0; i < segments; i += 1) {
      if (cp > b.readUInt16BE(ends + 2 * i)) continue;
      const start = b.readUInt16BE(starts + 2 * i);
      if (cp < start) return 0;
      const delta = b.readUInt16BE(deltas + 2 * i); // an int16 read as uint16: the same sum, modulo 2^16
      const rangeOffset = b.readUInt16BE(rangeOffsets + 2 * i);
      if (rangeOffset === 0) return (cp + delta) % 0x10000;
      const glyph = b.readUInt16BE(rangeOffsets + 2 * i + rangeOffset + 2 * (cp - start));
      return glyph === 0 ? 0 : (glyph + delta) % 0x10000;
    }
    return 0;
  };
}

const codePointName = (cp: number) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;

/** The code points of `required` the font has no glyph for, by name; or why its coverage cannot be read. */
function coverageGaps(b: Buffer, required: readonly number[]): string[] | string {
  const s = readSfnt(b);
  if (!s) return 'not a TrueType or OpenType file this guard can read';
  try {
    const glyphOf = cmapOf(s);
    if (!glyphOf) return 'no Unicode cmap (format 4 or 12) this guard can read';
    return required.filter((cp) => glyphOf(cp) === 0).map(codePointName);
  } catch (e) {
    return `its cmap cannot be read (${(e as Error).message})`;
  }
}

const span = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);
const niqqudIn = (s: string) =>
  [...new Set((s.match(/[ְ-ׇ]/g) ?? []).map((c) => c.codePointAt(0) as number))].sort((a, b) => a - b);
const isTestFile = (f: string) => /\/__tests__\/|\.test\.[cm]?[jt]sx?$/.test(f);
/** The niqqud the copy uses: each point of U+05B0–U+05C7 the app's own source holds, its tests left out. */
const COPY_NIQQUD = niqqudIn(TEXT_FILES.filter((f) => f.startsWith(`${APP}src/`) && !isTestFile(f)).map(text).join('\n'));
/** The punctuation right-to-left strings use, with the copy rules' ellipsis (U+2026); the copy has no "!". */
const RTL_PUNCTUATION = [...' .,:;?()-\'"/%…'].map((c) => c.codePointAt(0) as number);
/** CMP-122's code points, in order. */
const CMP122_REQUIRED: readonly number[] = [...new Set([
  ...span(0x05d0, 0x05ea), // the letters, finals included
  0x05be, 0x05f3, 0x05f4, // maqaf, geresh, gershayim
  0x20aa, // the sheqel sign
  ...COPY_NIQQUD,
  ...span(0x30, 0x39), // the Latin digits
  ...RTL_PUNCTUATION,
])].sort((a, b) => a - b);

// The one gap the shipped files have, pinned exactly so it can neither grow nor close unnoticed: Bellefair 1.003 has no
// gershayim (U+05F4); every other code point CMP-122 names is in every file. Android draws a code point a face lacks from
// another font, mid-word, so until the compliance-auditor rules on CMP-122 for the voice face, no voice line may hold ״.
const KNOWN_GAPS: Readonly<Record<string, readonly string[]>> = {
  [`${APP}assets/fonts/Bellefair-Regular.ttf`]: ['U+05F4'],
};

// ---- fixtures: the exact shapes that shipped, and the licence they should have carried -----------

const OFL_TEXT = `This Font Software is licensed under the SIL Open Font License, Version 1.1.
-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------
PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:
5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license.`;
const EULA_AS_OFL = `Fontshare EULA
Free Font - End User License Agreement (FF EULA)
02. Limitations of usage
The Fonts may not ... be distributed ... uploading them in a public server`;

/** A cmap of one Windows Unicode subtable mapping `codePoints` to glyphs 1, 2, 3…: format 4 (the BMP) or 12 (full). */
function makeCmap(format: 4 | 12, codePoints: readonly number[]): Buffer {
  const sorted = [...new Set(codePoints)].sort((a, b) => a - b);
  const runs: Array<[number, number, number]> = []; // [start, end, glyph of start]
  sorted.forEach((cp, i) => {
    const last = runs[runs.length - 1];
    if (last && cp === last[1] + 1) last[1] = cp;
    else runs.push([cp, cp, i + 1]);
  });
  const header = Buffer.alloc(12);
  header.writeUInt16BE(1, 2);
  header.writeUInt16BE(3, 4);
  header.writeUInt16BE(format === 12 ? 10 : 1, 6);
  header.writeUInt32BE(12, 8);
  if (format === 12) {
    const sub = Buffer.alloc(16 + 12 * runs.length);
    sub.writeUInt16BE(12, 0);
    sub.writeUInt32BE(sub.length, 4);
    sub.writeUInt32BE(runs.length, 12);
    runs.forEach(([start, end, glyph], i) => {
      sub.writeUInt32BE(start, 16 + 12 * i);
      sub.writeUInt32BE(end, 20 + 12 * i);
      sub.writeUInt32BE(glyph, 24 + 12 * i);
    });
    return Buffer.concat([header, sub]);
  }
  const segments = [...runs, [0xffff, 0xffff, 0] as [number, number, number]]; // the closing segment every format 4 has
  const n = segments.length;
  const sub = Buffer.alloc(16 + 8 * n);
  sub.writeUInt16BE(4, 0);
  sub.writeUInt16BE(sub.length, 2);
  sub.writeUInt16BE(2 * n, 6);
  segments.forEach(([start, end, glyph], i) => {
    sub.writeUInt16BE(end, 14 + 2 * i);
    sub.writeUInt16BE(start, 16 + 2 * n + 2 * i);
    sub.writeUInt16BE((((glyph - start) % 0x10000) + 0x10000) % 0x10000, 16 + 4 * n + 2 * i); // idDelta, mod 2^16
  });
  return Buffer.concat([header, sub]); // idRangeOffset is all zero: every glyph is start's plus the offset
}

/** A minimal sfnt laid out as a font file lays out its tables: a name table (Windows, Unicode, English), an OS/2, a cmap. */
function makeSfnt({ names = {}, weight, macNames = {}, cmap }: {
  names?: Readonly<Record<number, string>>; weight?: number; macNames?: Readonly<Record<number, string>>;
  cmap?: { readonly format: 4 | 12; readonly codePoints: readonly number[] };
}): Buffer {
  const records = [
    ...Object.entries(macNames).map(([id, s]) => ({ platform: 1, encoding: 0, language: 0, id: Number(id), raw: Buffer.from(s, 'latin1') })),
    ...Object.entries(names).map(([id, s]) => ({ platform: 3, encoding: 1, language: 0x409, id: Number(id), raw: Buffer.from(s, 'utf16le').swap16() })),
  ];
  const head = Buffer.alloc(6 + 12 * records.length);
  head.writeUInt16BE(records.length, 2);
  head.writeUInt16BE(head.length, 4);
  let at = 0;
  records.forEach((r, i) => {
    const o = 6 + 12 * i;
    head.writeUInt16BE(r.platform, o);
    head.writeUInt16BE(r.encoding, o + 2);
    head.writeUInt16BE(r.language, o + 4);
    head.writeUInt16BE(r.id, o + 6);
    head.writeUInt16BE(r.raw.length, o + 8);
    head.writeUInt16BE(at, o + 10);
    at += r.raw.length;
  });
  const tables: Array<[string, Buffer]> = [['name', Buffer.concat([head, ...records.map((r) => r.raw)])]];
  if (weight !== undefined) {
    const os2 = Buffer.alloc(78);
    os2.writeUInt16BE(weight, 4);
    tables.push(['OS/2', os2]);
  }
  if (cmap) tables.push(['cmap', makeCmap(cmap.format, cmap.codePoints)]);
  const directory = Buffer.alloc(12 + 16 * tables.length);
  directory.writeUInt32BE(0x00010000, 0);
  directory.writeUInt16BE(tables.length, 4);
  let offset = directory.length;
  tables.forEach(([tag, body], i) => {
    const o = 12 + 16 * i;
    directory.write(tag, o, 'latin1');
    directory.writeUInt32BE(offset, o + 8);
    directory.writeUInt32BE(body.length, o + 12);
    offset += body.length;
  });
  return Buffer.concat([directory, ...tables.map(([, body]) => body)]);
}

describe('the scan sees the real tree (a scan that finds nothing must fail, not pass)', () => {
  it('enumerates the tracked repository and reads its text files', () => {
    expect(TRACKED.length).toBeGreaterThan(500);
    expect(TRACKED).toContain(`${APP}src/design/tokens.ts`);
    expect(TRACKED).toContain(`${APP}ios/KokonadaHealth.xcodeproj/project.pbxproj`);
    expect(TEXT_FILES).toContain(`${APP}ios/KokonadaHealth/Info.plist`);
  });
});

describe('each check rejects the shape that shipped', () => {
  it('the real OFL passes; the EULA that sat in OFL.txt does not; OFL words plus an EULA do not', () => {
    expect(isRealOfl(OFL_TEXT)).toBe(true);
    expect(isRealOfl(EULA_AS_OFL)).toBe(false);
    expect(isRealOfl(`${OFL_TEXT}\n${EULA_AS_OFL}`)).toBe(false);
  });
  it('a font is recognised by extension and by signature, never a PNG', () => {
    expect(isFontFile('Face-Regular.otf', Buffer.alloc(0))).toBe(true);
    expect(isFontFile('renamed.bin', Buffer.from('OTTO\u0000\u000c', 'latin1'))).toBe(true);
    expect(isFontFile('renamed.dat', Buffer.from('wOF2\u0000\u0001', 'latin1'))).toBe(true);
    expect(isFontFile('icon.png', Buffer.from('\u0089PNG\r\n', 'latin1'))).toBe(false);
  });
  it('an embedded font is found by media type or by payload, never an embedded image', () => {
    expect(embedsFont("src:url(data:font/otf;base64,T1RUTwAMAIAAAwBA) format('opentype')")).toBe(true);
    expect(embedsFont('src:url(data:application/octet-stream;base64,T1RUTwAMAIAA)')).toBe(true);
    expect(embedsFont('src:url(data:application/font-woff2;charset=utf-8;base64,d09GMgABAAAA)')).toBe(true);
    expect(embedsFont('background:url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUg)')).toBe(false);
  });
});

describe('the sfnt reader reads what a font file says (a reader that misreads must fail, not pass)', () => {
  it('reads a name by its id, the Windows English record before a Mac one, and the OS/2 weight class', () => {
    const s = readSfnt(makeSfnt({ names: { 1: 'Heebo', 6: 'Heebo-Medium' }, macNames: { 6: 'Mac-Name' }, weight: 500 }));
    expect(s).not.toBeNull();
    expect(nameOf(s!, 6)).toBe('Heebo-Medium');
    expect(nameOf(s!, 1)).toBe('Heebo');
    expect(nameOf(s!, 16)).toBeNull();
    expect(weightClassOf(s!)).toBe(500);
    expect(nameOf(readSfnt(makeSfnt({ macNames: { 6: 'Only-Mac' } }))!, 6)).toBe('Only-Mac');
  });

  it('refuses what is not one TrueType or OpenType file: a WOFF2, a collection, a truncated directory', () => {
    expect(readSfnt(Buffer.from('wOF2\u0000\u0001\u0000\u0000', 'latin1'))).toBeNull();
    expect(readSfnt(Buffer.from('ttcf\u0000\u0001\u0000\u0000\u0000\u0000\u0000\u0000', 'latin1'))).toBeNull();
    expect(readSfnt(makeSfnt({ names: { 6: 'Heebo-Medium' } }).subarray(0, 20))).toBeNull();
  });

  it('reads the real files as their own metadata says (google/fonts METADATA.pb: post_script_name and weight)', () => {
    const read = (f: string) => { const s = readSfnt(bytes(`${APP}assets/fonts/${f}`))!; return [nameOf(s, 6), weightClassOf(s)]; };
    expect(read('Heebo-Regular.ttf')).toEqual(['Heebo-Regular', 400]);
    expect(read('Bellefair-Regular.ttf')).toEqual(['Bellefair-Regular', 400]);
  });
});

describe('each font file in the app is the face its file name says (UI-069, UI-072)', () => {
  it('a file whose PostScript name and weight class agree with its name passes; a renamed or mis-weighted one does not', () => {
    expect(faceMismatch('Heebo-Medium.ttf', makeSfnt({ names: { 6: 'Heebo-Medium' }, weight: 500 }))).toBeNull();
    expect(faceMismatch('Heebo-Light.ttf', makeSfnt({ names: { 6: 'Heebo-Medium' }, weight: 500 })))
      .toBe('its PostScript name is "Heebo-Medium", not its file name "Heebo-Light"');
    expect(faceMismatch('Heebo-Medium.ttf', makeSfnt({ names: { 6: 'Heebo-Medium' }, weight: 400 })))
      .toBe('its weight class is 400, not the 500 its style Medium says');
    expect(faceMismatch('Heebo.ttf', makeSfnt({ names: { 6: 'Heebo' }, weight: 400 }))).toBe('"Heebo" names no weight after its hyphen');
    expect(faceMismatch('Face-Regular.woff2', Buffer.from('wOF2\u0000\u0001', 'latin1'))).toBe('not a TrueType or OpenType file this guard can read');
  });

  it('the scan sees the app\'s font files (a scan that finds none must fail, not pass)', () => {
    expect(APP_FONTS.length).toBeGreaterThan(0);
  });

  it('every font file in the app is the face its file name says', () => {
    const offenders = APP_FONTS.map((f) => [f, faceMismatch(f, bytes(f))]).filter(([, why]) => why !== null);
    expect(offenders).toEqual([]);
  });
});

describe('each font file in the app is its upstream file, byte for byte (CMP-118, CMP-124)', () => {
  it('every font file in the app is pinned to its upstream, matches it, and every pin is a file in the tree', () => {
    const unpinned = APP_FONTS.filter((f) => !(f in UPSTREAM_FONTS));
    const changed = APP_FONTS.filter((f) => f in UPSTREAM_FONTS && sha256(bytes(f)) !== UPSTREAM_FONTS[f].sha256);
    const stale = Object.keys(UPSTREAM_FONTS).filter((f) => !APP_FONTS.includes(f));
    expect({ unpinned, changed, stale }).toEqual({ unpinned: [], changed: [], stale: [] });
  });
});

// X4 (compliance-auditor) and CMP-117: "a font is here only with the real OFL text beside it" accepted any OFL text in
// the folder, so with two families in one folder each font passed on the other's licence. A font's licence is now its
// own family's: OFL-<family>.txt beside it, the real OFL, carrying the copyright notice the font itself carries (name 0).
describe('each font file maps to its own family\'s licence (X4, CMP-117)', () => {
  const HEEBO_NOTICE = 'Copyright 2014 The Heebo Project Authors (https://github.com/OdedEzer/heebo)';
  const BELLEFAIR_NOTICE = 'Copyright 2015 The Bellefair Project Authors (https://github.com/shinntype/bellefair)';
  const heebo = makeSfnt({ names: { 0: HEEBO_NOTICE, 1: 'Heebo Medium', 16: 'Heebo', 6: 'Heebo-Medium' }, weight: 500 });
  const folder = (files: Readonly<Record<string, string>>) => (name: string) => files[name] ?? null;

  it('passes a font beside OFL-<its family>.txt: the real OFL, with the copyright notice the font carries', () => {
    expect(licenceMismatch(heebo, folder({ 'OFL-Heebo.txt': `${HEEBO_NOTICE}\n\n${OFL_TEXT}` }))).toBeNull();
  });

  it('refuses a font beside only another family\'s licence: an OFL in the folder is not its licence', () => {
    const bellefair = `${BELLEFAIR_NOTICE}\n\n${OFL_TEXT}`;
    expect(licenceMismatch(heebo, folder({ 'OFL-Bellefair.txt': bellefair, 'OFL.txt': bellefair }))).toBe('no OFL-Heebo.txt beside it');
  });

  it('refuses a licence named for the family that carries another family\'s copyright line', () => {
    expect(licenceMismatch(heebo, folder({ 'OFL-Heebo.txt': `${BELLEFAIR_NOTICE}\n\n${OFL_TEXT}` })))
      .toBe(`OFL-Heebo.txt does not carry the font's copyright notice: ${HEEBO_NOTICE}`);
  });

  it('refuses the shape General Sans shipped in: the Fontshare EULA beside it, under OFL.txt or under its family\'s name', () => {
    const generalSans = makeSfnt({ names: { 0: 'Copyright the General Sans authors', 1: 'General Sans', 6: 'GeneralSans-Semibold' }, weight: 600 });
    expect(licenceMismatch(generalSans, folder({ 'OFL.txt': EULA_AS_OFL }))).toBe('no OFL-GeneralSans.txt beside it');
    expect(licenceMismatch(generalSans, folder({ 'OFL-GeneralSans.txt': EULA_AS_OFL }))).toBe('OFL-GeneralSans.txt is not the SIL Open Font License 1.1');
  });

  it('takes the family from the typographic family (name 16) before name 1, without spaces in the file name', () => {
    // A static Light cut is the family "Heebo Light" (name 1) in the typographic family "Heebo" (name 16): one licence.
    const light = makeSfnt({ names: { 0: HEEBO_NOTICE, 1: 'Heebo Light', 16: 'Heebo', 6: 'Heebo-Light' }, weight: 300 });
    expect(licenceMismatch(light, folder({ 'OFL-Heebo.txt': `${HEEBO_NOTICE}\n${OFL_TEXT}` }))).toBeNull();
    const spaced = makeSfnt({ names: { 0: 'Copyright 2019 The Frank Ruhl Libre Project Authors', 1: 'Frank Ruhl Libre', 6: 'FrankRuhlLibre-Light' } });
    expect(licenceMismatch(spaced, folder({}))).toBe('no OFL-FrankRuhlLibre.txt beside it');
  });

  it('refuses a font it cannot read, one that names no family, and one that carries no copyright notice', () => {
    expect(licenceMismatch(Buffer.from('wOF2\u0000\u0001', 'latin1'), folder({})))
      .toBe('not a TrueType or OpenType file this guard can read, so its family cannot be known');
    expect(licenceMismatch(makeSfnt({ names: { 0: HEEBO_NOTICE, 6: 'Heebo-Regular' } }), folder({}))).toBe('it names no family (name 16 or 1)');
    expect(licenceMismatch(makeSfnt({ names: { 1: 'Heebo', 6: 'Heebo-Regular' } }), folder({ 'OFL-Heebo.txt': OFL_TEXT })))
      .toBe('it carries no copyright notice (name 0) for its licence to repeat');
  });

  it('every licence in the app is its upstream text, line endings aside, and every pin is a file in the tree (CMP-124)', () => {
    const licences = TRACKED.filter((f) => f.startsWith(APP) && /^OFL-[\w.-]+\.txt$/.test(base(f)));
    expect(licences.length).toBeGreaterThan(0);
    const lf = (f: string) => sha256(Buffer.from(text(f).replace(/\r\n/g, '\n'), 'utf8'));
    const unpinned = licences.filter((f) => !(f in UPSTREAM_LICENCES));
    const changed = licences.filter((f) => f in UPSTREAM_LICENCES && lf(f) !== UPSTREAM_LICENCES[f].sha256);
    const stale = Object.keys(UPSTREAM_LICENCES).filter((f) => !licences.includes(f));
    expect({ unpinned, changed, stale }).toEqual({ unpinned: [], changed: [], stale: [] });
  });
});

// CMP-122: before a face is used, each shipped file's cmap is checked for the Hebrew letters U+05D0–U+05EA, maqaf,
// geresh, gershayim, the sheqel sign, the niqqud the copy uses, and the Latin digits and punctuation of right-to-left
// strings. A code point a face lacks is drawn by Android from another font, mid-word.
describe('each font file in the app covers the Hebrew the copy needs (CMP-122)', () => {
  it('the set is CMP-122\'s: 27 letters, maqaf, geresh, gershayim, the sheqel sign, the copy\'s niqqud, digits, RTL punctuation', () => {
    const hex = CMP122_REQUIRED.map(codePointName);
    expect(hex.filter((h) => h >= 'U+05D0' && h <= 'U+05EA')).toHaveLength(27);
    expect(hex).toEqual(expect.arrayContaining(['U+05BE', 'U+05F3', 'U+05F4', 'U+20AA', 'U+0030', 'U+0039', 'U+0020', 'U+002E', 'U+002C', 'U+003F', 'U+0022', 'U+0027', 'U+2026']));
    expect(hex).not.toContain('U+0021'); // the copy has no "!" (the design ledger's copy rules)
  });

  it('the copy\'s niqqud is what the app\'s own source holds of U+05B0–U+05C7, its tests left out: none today', () => {
    expect(COPY_NIQQUD).toEqual([]);
    // shalom with its points: shin, qamats, shin dot, lamed, vav, holam, final mem. The scan finds the three points.
    expect(niqqudIn('שָׁלוֹם')).toEqual([0x05b8, 0x05b9, 0x05c1]);
  });

  it('reads coverage from a format 4 and a format 12 cmap alike, and names each code point missing', () => {
    for (const format of [4, 12] as const) {
      expect(coverageGaps(makeSfnt({ cmap: { format, codePoints: CMP122_REQUIRED } }), CMP122_REQUIRED)).toEqual([]);
      const holed = CMP122_REQUIRED.filter((c) => c !== 0x05d0 && c !== 0x20aa);
      expect(coverageGaps(makeSfnt({ cmap: { format, codePoints: holed } }), CMP122_REQUIRED)).toEqual(['U+05D0', 'U+20AA']);
    }
    expect(coverageGaps(makeSfnt({ cmap: { format: 12, codePoints: [0x1f600] } }), [0x1f600])).toEqual([]); // past the BMP
    expect(coverageGaps(makeSfnt({ cmap: { format: 4, codePoints: [0x05d0] } }), [0x1f600])).toEqual(['U+1F600']); // format 4 is the BMP
  });

  it('refuses a font with no cmap it can read', () => {
    expect(coverageGaps(makeSfnt({ names: { 6: 'X-Regular' } }), [0x05d0])).toBe('no Unicode cmap (format 4 or 12) this guard can read');
    expect(coverageGaps(Buffer.from('wOF2\u0000\u0001', 'latin1'), [0x05d0])).toBe('not a TrueType or OpenType file this guard can read');
  });

  it('every font file in the app has a glyph for each code point CMP-122 names, but the gap pinned in KNOWN_GAPS', () => {
    const gaps = Object.fromEntries(
      APP_FONTS.map((f) => [f, coverageGaps(bytes(f), CMP122_REQUIRED)] as const).filter(([, g]) => g.length > 0),
    );
    expect(gaps).toEqual(KNOWN_GAPS);
  });
});

describe('fonts in the repository carry the real OFL text (HX-8)', () => {
  it('every font file has its own family\'s licence beside it (X4: no longer any OFL text in the folder)', () => {
    const beside = (f: string) => (name: string) => {
      const g = `${dir(f)}/${name}`;
      return TRACKED.includes(g) ? text(g) : null;
    };
    const offenders = TRACKED.filter((f) => isFontFile(f, bytes(f)))
      .map((f) => [f, licenceMismatch(bytes(f), beside(f))])
      .filter(([, why]) => why !== null);
    expect(offenders).toEqual([]);
  });

  it('every file named as the OFL is the OFL', () => {
    const fakes = TRACKED.filter((f) => OFL_NAMED.test(base(f))).filter((f) => !isRealOfl(text(f)));
    expect(fakes).toEqual([]);
  });

  it('no document embeds a font without the real OFL text beside it', () => {
    const offenders = TEXT_FILES.filter((f) => f !== SELF && embedsFont(text(f))).filter((f) => !hasRealOflBeside(f));
    expect(offenders).toEqual([]);
  });
});

describe('the app names only the faces it ships (HX-8)', () => {
  it('no app file names General Sans (tokens, Info.plist, the Xcode project, the RN config, tests)', () => {
    const offenders = TEXT_FILES.filter((f) => f.startsWith(APP) && f !== SELF).filter((f) => /general[\s_-]*sans/i.test(text(f)));
    expect(offenders).toEqual([]);
  });

  it('no code or config loads a font file the repository does not hold', () => {
    const held = new Set(TRACKED.filter((f) => FONT_EXT.test(f)).map(base));
    const dangling = TEXT_FILES.filter((f) => f !== SELF && !/\.md$/i.test(f)).flatMap((f) =>
      [...text(f).matchAll(/[\w.-]+\.(?:otf|ttf|ttc|woff2?|eot)\b/gi)]
        .map((m) => m[0])
        .filter((name) => !held.has(name))
        .map((name) => `${f}: ${name}`),
    );
    expect([...new Set(dangling)]).toEqual([]);
  });

  it('every asset the Xcode project bundles from ../assets exists', () => {
    const pbx = `${APP}ios/KokonadaHealth.xcodeproj/project.pbxproj`;
    const refs = [...text(pbx).matchAll(/path = "(\.\.\/assets\/[^"]+)"/g)].map((m) => m[1]);
    expect(refs.length).toBeGreaterThan(0);
    const missing = refs
      .map((r) => path.posix.normalize(`${APP}ios/${r}`))
      .filter((f) => !TRACKED.includes(f));
    expect(missing).toEqual([]);
  });
});
