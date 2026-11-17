/// <reference types="node" />
import * as path from 'path';
import ts from 'typescript';
import { APP_ROOT } from '../../../src/testing/guards/productionImports';
import { isTestFile, walkSources } from '../../../src/testing/guards/sourceFiles';
import { ACTION_PROP_GATE_ROOTS, scanActionProps } from '../actionProps';

// QA-115, required-props half (Stage 0 Q2). Action callbacks are required props with no no-op default: an
// optional `on[A-Z]*` callback, or one defaulting to `() => {}` or a noop, lets a screen render green in a
// test while its navigator passes nothing (MB-026, MB-027). The scanner reads the TypeScript syntax tree.
// It is NOT a gate yet: over src/design/v2 and src/pages it would pass with nothing to scan until V1
// merges (D8 rule 3), so it stays a report and OPS-420 registers it. Planted sources are in memory.

const q = (s: string) => String.fromCharCode(39) + s + String.fromCharCode(39);
const kinds = (src: string) => scanActionProps(src, 'planted.tsx').map((f) => `${f.prop}:${f.kind}`);

describe('QA-115 · the action-props scanner', () => {
  it.each([
    ['an optional function prop in an interface', 'interface P { onPress?: () => void }', ['onPress:optional-prop']],
    ['an optional prop in an inline type literal', 'export function W({ onSettle }: { onSettle?: () => void }) { return null; }', ['onSettle:optional-prop']],
    ['an optional method signature', 'type P = { onClose?(reason: string): void };', ['onClose:optional-prop']],
    ['an optional function in a union', 'interface P { onRetry?: (() => void) | null }', ['onRetry:optional-prop']],
    ['an optional prop typed by a handler alias', 'interface P { onChange?: ChangeHandler }', ['onChange:optional-prop']],
    ['a destructured no-op arrow default', 'function S({ onGenerate = () => {} }: P) { return null; }', ['onGenerate:noop-default']],
    ['a destructured empty function default', 'const S = ({ onTap = function () {} }: P) => null;', ['onTap:noop-default']],
    ['a destructured noop identifier default', 'function S({ onClose = noop }: P) { return null; }', ['onClose:noop-default']],
    ['a renamed destructured no-op default', 'function S({ onOpen: open = () => undefined }: P) { return null; }', ['onOpen:noop-default']],
    ['an optional prop typed by an indexed access to a callback', 'interface P { onPress?: PressableProps[' + q('onPress') + '] }', ['onPress:optional-prop']],
    ['an optional prop typed Function', 'interface P { onPress?: Function }', ['onPress:optional-prop']],
    ['a required prop that admits undefined', 'interface P { onPress: (() => void) | undefined }', ['onPress:optional-prop']],
    ['a destructured default returning null', 'function S({ onPress = () => null }: P) { return null; }', ['onPress:noop-default']],
    ['a destructured Function.prototype default', 'function S({ onPress = Function.prototype }: P) { return null; }', ['onPress:noop-default']],
  ])('planted positive: %s is flagged', (_name, src, expected) => {
    expect(kinds(src)).toEqual(expected);
  });

  it.each([
    ['a required function prop', 'interface P { onPress: () => void }'],
    ['an optional prop that is not a callback (Skeleton onSurface)', 'interface P { onSurface?: SkeletonSurface }'],
    ['an optional callback not named on[A-Z]', 'interface P { once?: () => void; offset?: () => void; render?: () => void }'],
    ['a destructured real handler default', 'function S({ onPress = handlePress }: P) { return null; }'],
    ['a destructured default that does something', 'function S({ onPress = () => track(1) }: P) { return null; }'],
    ['a required callback prop with a non-callback union member', 'interface P { onPress: (() => void) | null }'],
    ['an optional prop typed by an indexed access to a non-callback key', 'interface P { onSurface?: SkeletonProps[' + q('surface') + '] }'],
    ['a destructured default returning a value that is not null', 'function S({ onPress = () => 0 }: P) { return null; }'],
    ['a destructured default whose block does something', 'function S({ onPress = () => { track(1); } }: P) { return null; }'],
    ['text that only looks like a prop', 'const s = ' + q('interface P { onPress?: () => void }') + ';'],
  ])('planted negative: %s is not flagged', (_name, src) => {
    expect(kinds(src)).toEqual([]);
  });

  it('reports a line for each finding', () => {
    const findings = scanActionProps('interface P {\n  a: number;\n  onPress?: () => void;\n}\n', 'p.tsx');
    expect(findings).toEqual([{ file: 'p.tsx', line: 3, prop: 'onPress', kind: 'optional-prop' }]);
  });

  it('report only, over v1 (it sees: HistoryScreen.tsx defaults its two actions to no-ops, MB-026)', () => {
    const history = path.join(APP_ROOT, 'src/experience/history/HistoryScreen.tsx');
    const found = scanActionProps(ts.sys.readFile(history)!, 'src/experience/history/HistoryScreen.tsx').map((f) => `${f.prop}:${f.kind}`);
    expect(found).toEqual(expect.arrayContaining(['onGenerate:optional-prop', 'onOpenSession:optional-prop', 'onGenerate:noop-default', 'onOpenSession:noop-default']));
    const files = walkSources(path.join(APP_ROOT, 'src')).filter((f) => /\.tsx?$/.test(f) && !isTestFile(f));
    expect(files.length).toBeGreaterThan(100);
    const all = files.flatMap((f) => scanActionProps(ts.sys.readFile(f)!, path.relative(APP_ROOT, f).split(path.sep).join('/')));
    console.log(`QA-115 report (v1, not a gate): ${all.length} findings in ${new Set(all.map((f) => f.file)).size} of ${files.length} files\n`
      + all.map((f) => `  ${f.file}:${f.line} ${f.prop} ${f.kind}`).join('\n'));
    expect(all.length).toBeGreaterThan(0);
  });

  it('is not registered as a gate until src/design/v2 and src/pages are on main (OPS-420)', () => {
    expect(ACTION_PROP_GATE_ROOTS).toEqual([]);
  });
});
