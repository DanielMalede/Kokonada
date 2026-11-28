/// <reference types="node" />
import * as path from 'path';
import { closure, offences, relTo, scan, type Bans } from '../../__tests__/__fixtures__/importClosure.ts';

// Build note E (DEC-198): the InlineNotice is presentational only. Its labels and handlers come from the caller, so nothing
// it reaches may open a URL (Linking, or a call named openURL), read a copy catalog (v2's copy port, the app's i18n or
// locales) or a legal module (src/legal/**, the bound legal links). The guard walks the syntax tree of every file in its
// import closure; the planted sources below must fail, or it is blind.

const V2 = path.resolve(__dirname, '../../..');
const ENTRY = path.resolve(__dirname, '../InlineNotice.tsx');
const rel = relTo(V2);

const BANS: Bans = {
  modules: [/(^|\/)copy(\/|$)/, /(^|\/)i18n(\/|$)/, /(^|\/)locales?(\/|$)/, /(^|\/)legal(\/|$)/, /legalLinks|legalCopy|CopyPort|useCopy/],
  rnNames: new Set(['Linking']),
  identifiers: new Set(['Linking', 'openURL', 'openLegalDoc', 'useCopy', 'createCopyPort', 'PRIVACY_POLICY_URL', 'TERMS_OF_USE_URL']),
};

describe('InlineNotice’s closure is presentational (build note E)', () => {
  const files = closure(V2, ENTRY);

  it('the walk sees the real closure: the component, its rules, the tokens and the faces', () => {
    expect([...files.keys()].map(rel)).toEqual(
      expect.arrayContaining(['components/InlineNotice/InlineNotice.tsx', 'components/InlineNotice/actionLayout.ts', 'tokens/useTokens.ts', 'typeface/faces.ts']),
    );
    const all = [...files.values()];
    expect(all.flatMap((s) => s.rnNames)).toEqual(expect.arrayContaining(['Pressable', 'Text', 'View']));
    expect(all.flatMap((s) => s.identifiers).length).toBeGreaterThan(300);
  });

  it('no file in it names Linking, a copy catalog or a legal module', () => {
    const found = [...files.entries()].flatMap(([file, s]) => offences(s, BANS).map((o) => `${rel(file)}: ${o}`));
    expect(found).toEqual([]);
  });

  // Each planted source is assembled at run time, so this file never trips its own walk.
  const q = String.fromCharCode(39);
  const from = (what: string, spec: string) => 'import ' + what + ' from ' + q + spec + q + ';';
  it.each([
    ['Linking', from('{ Linking, View }', 'react-native'), 'react-native Linking'],
    ['openURL by any route', 'export const go = (u: string) => (globalThis as any).' + 'open' + 'URL(u);', 'identifier openURL'],
    ['the copy port', from('{ useCopy }', '../../copy/' + 'useCopy.ts'), 'module ../../copy/useCopy.ts'],
    ['the app’s legal links', from('{ PRIVACY_POLICY_URL }', '../../../../' + 'legal/legalLinks'), 'module ../../../../legal/legalLinks'],
    ['a legal document', 'const d = require(' + q + '../../../../legal/' + 'documents/privacy.en' + q + ');', 'module ../../../../legal/documents/privacy.en'],
    ['a catalog by its locale', from('en', '../../../../i18n/' + 'locales/en.json'), 'module ../../../../i18n/locales/en.json'],
  ])('flags a planted file that reaches %s', (_label, source, offence) => {
    expect(offences(scan(source, path.join(V2, 'components', 'InlineNotice', 'planted.tsx')), BANS)).toContain(offence);
  });

  it('does not flag what a notice may use: views, text, a pressable, the tokens', () => {
    const source = from('{ Pressable, StyleSheet, Text, View }', 'react-native') + '\n' + from('{ useTokens }', '../../tokens/useTokens.ts');
    expect(offences(scan(source, path.join(V2, 'components', 'InlineNotice', 'planted.tsx')), BANS)).toEqual([]);
  });
});
