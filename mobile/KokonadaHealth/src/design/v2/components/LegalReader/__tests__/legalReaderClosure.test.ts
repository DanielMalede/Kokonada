/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { closure, offences, relTo, scan, type Bans, type Scan } from '../../__tests__/__fixtures__/importClosure.ts';

// P1 spec §B.2: the reader makes no request and uses no WebView, Custom Tab or Linking, and its text is injected, never
// read from src/legal/documents/** (P1-R2-3). CMP-122 (P1-D5): it draws in Heebo only, never the voice face. Both are
// pinned on the syntax tree of every file in the reader's import closure; the planted sources below must fail.

const V2 = path.resolve(__dirname, '../../..');
const ENTRY = path.resolve(__dirname, '../LegalReader.tsx');
const OWN = path.resolve(__dirname, '..');
const rel = relTo(V2);
const q = String.fromCharCode(39);

/** No request, no browser, no URL opened, no legal module, no copy catalog. */
const NETWORK: Bans = {
  modules: [
    /react-native-webview/,
    /inappbrowser|custom-?tabs|react-native-browser/i,
    /axios|ky$|superagent|cross-fetch|node-fetch|whatwg-fetch/,
    /socket\.io|websocket/i,
    /(^|\/)(net|api|app|auth|state|storage)(\/|$)/,
    /(^|\/)legal(\/|$)/,
    /(^|\/)copy(\/|$)/,
  ],
  rnNames: new Set(['Linking', 'NativeModules', 'TurboModuleRegistry']),
  identifiers: new Set(['Linking', 'openURL', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'sendBeacon', 'NativeModules', 'openLegalDoc', 'resolveLegalDoc']),
};

/** The voice face by every name it has: its token, its family, its fallback. */
const VOICE_IDENTIFIERS = new Set(['voice', 'voiceFallback', 'voiceFallbackWeight']);
const VOICE_STRINGS = /Bellefair|Frank\s*Ruhl/i;
function voiceUses(s: Scan): string[] {
  return [
    ...s.identifiers.filter((n) => VOICE_IDENTIFIERS.has(n)).map((n) => `identifier ${n}`),
    ...s.strings.filter((t) => VOICE_STRINGS.test(t)).map((t) => `string ${t}`),
  ];
}

describe('LegalReader’s closure: no network, no Linking, no legal module (P1 §B.2)', () => {
  const files = closure(V2, ENTRY);

  it('the walk sees the real closure: the reader, its document rules, its spacing, the tokens and the faces', () => {
    expect([...files.keys()].map(rel)).toEqual(
      expect.arrayContaining([
        'components/LegalReader/LegalReader.tsx',
        'components/LegalReader/legalDocument.ts',
        'components/LegalReader/readerSpace.ts',
        'tokens/useTokens.ts',
        'typeface/faces.ts',
      ]),
    );
    const all = [...files.values()];
    expect(all.flatMap((s) => s.rnNames)).toEqual(expect.arrayContaining(['ScrollView', 'Text', 'Pressable', 'AccessibilityInfo']));
    expect(all.flatMap((s) => s.identifiers).length).toBeGreaterThan(400);
  });

  it('no file in it names a network module, a browser, Linking, a legal module or a copy catalog', () => {
    const found = [...files.entries()].flatMap(([file, s]) => offences(s, NETWORK).map((o) => `${rel(file)}: ${o}`));
    expect(found).toEqual([]);
  });

  const from = (what: string, spec: string) => 'import ' + what + ' from ' + q + spec + q + ';';
  const planted = (source: string) => offences(scan(source, path.join(OWN, 'planted.tsx')), NETWORK);
  it.each([
    ['Linking', from('{ Linking }', 'react-native'), 'react-native Linking'],
    ['openURL', 'export const go = (u: string) => api.' + 'open' + 'URL(u);', 'identifier openURL'],
    ['a request by fetch', 'export const get = () => ' + 'fe' + 'tch(' + q + 'https://example.org' + q + ');', 'identifier fetch'],
    ['a WebView', from('{ WebView }', 'react-native-' + 'webview'), 'module react-native-webview'],
    ['a bundled legal document', from('{ PRIVACY }', '../../../../legal/' + 'documents/privacy.en'), 'module ../../../../legal/documents/privacy.en'],
    ['the app’s network layer', 'const n = require(' + q + '../../../../' + 'net/http' + q + ');', 'module ../../../../net/http'],
    ['the copy port', from('{ useCopy }', '../../' + 'copy/useCopy.ts'), 'module ../../copy/useCopy.ts'],
  ])('flags a planted file that reaches %s', (_label, source, offence) => {
    expect(planted(source)).toContain(offence);
  });

  it('does not flag what the reader may use: views, a scroll view, text, a pressable, the accessibility focus', () => {
    expect(planted(from('{ AccessibilityInfo, Pressable, ScrollView, Text, View }', 'react-native'))).toEqual([]);
  });
});

describe('LegalReader draws in Heebo only (CMP-122)', () => {
  // The reader's own files: none of them names the voice face. The shared tokens and faces modules name it, since other
  // components draw the voice, so the pin is on the files that are the reader's.
  const own = fs.readdirSync(OWN).filter((f) => /\.tsx?$/.test(f)).map((f) => path.join(OWN, f));

  it('the reader’s own files are there, and the face they set is the UI face', () => {
    expect(own.map((f) => path.basename(f)).sort()).toEqual(expect.arrayContaining(['LegalReader.tsx', 'legalDocument.ts', 'readerSpace.ts']));
    const reader = scan(fs.readFileSync(ENTRY, 'utf8'), ENTRY);
    expect(reader.identifiers).toEqual(expect.arrayContaining(['fontFace', 'face', 'ui']));
  });

  it('no file of the reader names the voice token, its fallback, or the Bellefair or Frank Ruhl families', () => {
    const found = own.flatMap((f) => voiceUses(scan(fs.readFileSync(f, 'utf8'), f)).map((o) => `${path.basename(f)}: ${o}`));
    expect(found).toEqual([]);
  });

  it.each([
    ['the voice token', 'const t = tokens.base.type.' + 'voice' + '.m.latin;', 'identifier voice'],
    ['the voice family', 'const f = tokens.base.type.face.' + 'voice' + ';', 'identifier voice'],
    ['the fallback', 'const f = tokens.base.type.face.' + 'voiceFallback' + ';', 'identifier voiceFallback'],
    ['a family by name', 'const s = { fontFamily: ' + q + 'Belle' + 'fair-Regular' + q + ' };', 'string Bellefair-Regular'],
  ])('planted: flags a reader file that reaches %s', (_label, source, use) => {
    expect(voiceUses(scan(source, path.join(OWN, 'planted.tsx')))).toContain(use);
  });
});
