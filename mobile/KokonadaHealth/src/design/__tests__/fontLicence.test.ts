/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';

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
