/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { createHash } from 'crypto';

// FONT LICENCE GUARD (HX-8 · CMP-120 · UI-013). A display face shipped under a licence that forbids
// redistributing the font file, beside a file named OFL.txt that held that other licence, and a README
// that called it OFL. Nothing checked any of it. These scans pin the rule the repository now keeps:
//   1. a font is here only with the real SIL Open Font License text beside it;
//   2. a file that presents itself as the OFL is the OFL;
//   3. a font carried inside a document (a base64 data: URI) obeys rule 1, because it is the same bytes;
//   4. the app names no face it does not ship, and loads no font file the repository does not hold;
//   5. the Xcode project bundles nothing that is not on disk (iOS cannot be built here, so this is
//      the only evidence the project still resolves after files are removed).
// The enumerator is `git ls-files` from the repository root, the attribution guard's idiom: "tracked"
// is the boundary that reaches a public remote and a build, and it is the same on every machine.

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

/** A minimal sfnt laid out as a font file lays out its tables: a name table (Windows, Unicode, English) and an OS/2. */
function makeSfnt({ names = {}, weight, macNames = {} }: {
  names?: Readonly<Record<number, string>>; weight?: number; macNames?: Readonly<Record<number, string>>;
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

describe('fonts in the repository carry the real OFL text (HX-8)', () => {
  it('every font file has the real OFL text beside it', () => {
    const offenders = TRACKED.filter((f) => isFontFile(f, bytes(f))).filter((f) => !hasRealOflBeside(f));
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
