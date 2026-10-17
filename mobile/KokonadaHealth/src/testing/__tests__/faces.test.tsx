import React from 'react';
import * as RN from 'react-native';
import { Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { useTheme } from '../../design/theme';
import { colors } from '../../design/tokens';
import { FACES, NO_FACE, createFaceGuard, useFaceGuard, type FaceGuardHooks } from '../faces';

// QA-111: every v2 render test runs in light AND dark, by capture-and-restore of the preset's
// useColorScheme mock (jest-preset/jest/mocks/useColorScheme.js:13 forces 'light'), and the harness
// FAILS a test that never sets a face. The ConsentSheet cross-face bug (1.08:1, ConsentSheet.test.tsx
// :230-238) hid exactly there: an unforced render only ever saw the light face.

const hook = RN.useColorScheme as unknown as jest.Mock;

// The real production consumer: useTheme() reads useColorScheme() and resolves the palette.
function Ink() {
  const { name, c } = useTheme();
  return <Text testID="ink" style={{ color: c.content.primary }}>{name}</Text>;
}
// Every tree is unmounted after its test: a mounted consumer holds a live scheme subscription.
const mounted: ReactTestRenderer.ReactTestRenderer[] = [];
const render = (el: React.ReactElement) => {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  act(() => { tree = ReactTestRenderer.create(el); });
  mounted.push(tree);
  return tree;
};
const unmountAll = () => { for (const t of mounted.splice(0)) act(() => { t.unmount(); }); };
afterEach(unmountAll);
const inkOf = (tree: ReactTestRenderer.ReactTestRenderer) => tree.root.findByProps({ testID: 'ink' }).props.style.color;

// A hand-driven lifecycle: the guard's hooks are captured, then run in jest's order, so the wiring
// itself (not only the functions it calls) is what these tests exercise.
function lifecycle() {
  const hooks = { before: [] as Array<() => void>, after: [] as Array<() => void>, afterAll: [] as Array<() => void> };
  const registrars: FaceGuardHooks = {
    beforeEach: (fn) => { hooks.before.push(fn); },
    afterEach: (fn) => { hooks.after.push(fn); },
    afterAll: (fn) => { hooks.afterAll.push(fn); },
  };
  const runTest = (body: () => void) => {
    hooks.before.forEach((fn) => fn());
    let bodyError: unknown = null;
    try { body(); } catch (e) { bodyError = e; }
    const afterErrors: unknown[] = [];
    for (const fn of hooks.after) { try { fn(); } catch (e) { afterErrors.push(e); } }
    return { bodyError, afterErrors };
  };
  const endSuite = () => { const errs: unknown[] = []; for (const fn of hooks.afterAll) { try { fn(); } catch (e) { errs.push(e); } } return errs; };
  return { registrars, runTest, endSuite };
}

describe('QA-111 · the face guard (driven through its own hooks)', () => {
  afterEach(() => { expect(hook.getMockImplementation()?.()).toBe('light'); }); // every case leaves the preset intact

  it('fails a test whose render reads the colour scheme before any face is set', () => {
    const { registrars, runTest } = lifecycle();
    useFaceGuard({}, registrars);
    const { bodyError, afterErrors } = runTest(() => { render(<Ink />); });
    expect(String(bodyError)).toContain(NO_FACE);
    expect(afterErrors.map(String).join(' ')).toContain('never set a face');
  });

  it('fails a test that never sets a face even when nothing it renders reads the scheme', () => {
    const { registrars, runTest } = lifecycle();
    useFaceGuard({}, registrars);
    const { bodyError, afterErrors } = runTest(() => { render(<Text>static</Text>); });
    expect(bodyError).toBeNull();
    expect(afterErrors.map(String).join(' ')).toContain('never set a face');
  });

  it('passes a test that sets a face, and renders THAT face through the real useTheme()', () => {
    const { registrars, runTest } = lifecycle();
    const faces = useFaceGuard({}, registrars);
    let seen: unknown[] = [];
    const { bodyError, afterErrors } = runTest(() => {
      faces.set('dark');
      const tree = render(<Ink />);
      seen = [tree.root.findByProps({ testID: 'ink' }).props.children, inkOf(tree)];
    });
    expect(bodyError).toBeNull();
    expect(afterErrors).toEqual([]);
    expect(seen).toEqual(['dark', colors.dark.content.primary]);
  });

  it('fails a suite that rendered only one face', () => {
    const { registrars, runTest, endSuite } = lifecycle();
    const faces = useFaceGuard({}, registrars);
    runTest(() => { faces.set('dark'); render(<Ink />); });
    runTest(() => { faces.set('dark'); render(<Ink />); });
    expect(endSuite().map(String).join(' ')).toContain('only the dark face');
  });

  it('passes a suite that rendered both faces', () => {
    const { registrars, runTest, endSuite } = lifecycle();
    const faces = useFaceGuard({}, registrars);
    for (const face of FACES) runTest(() => { faces.set(face); render(<Ink />); });
    expect(endSuite()).toEqual([]);
  });

});

describe('QA-111 · the real wiring: useFaceGuard() and faces.each() in a live suite', () => {
  const faces = useFaceGuard();
  faces.each((face) => {
    it('renders this face through the real useTheme()', () => {
      expect(faces.current()).toBe(face);
      expect(inkOf(render(<Ink />))).toBe(colors[face].content.primary);
    });
  });
});

describe('QA-111 · capture and restore of the preset (no spyOn, no leak)', () => {
  it('restores the preset implementation by identity', () => {
    const preset = hook.getMockImplementation();
    const guard = createFaceGuard();
    guard.install();
    expect(hook.getMockImplementation()).not.toBe(preset);
    guard.restore();
    expect(hook.getMockImplementation()).toBe(preset);
    expect(hook()).toBe('light');
  });

  it('refuses to capture a preset an earlier test already mutated (the OPS-017 leak)', () => {
    const preset = hook.getMockImplementation()!;
    hook.mockReturnValue('dark'); // what jest.spyOn(RN, 'useColorScheme').mockReturnValue('dark') does
    try {
      expect(() => createFaceGuard().install()).toThrow(/mutated before the face harness captured it/);
    } finally {
      hook.mockImplementation(preset);
    }
  });

  it('a mid-session face change re-renders a mounted consumer, as the real hook (Appearance-subscribed) does', () => {
    const guard = createFaceGuard();
    guard.install();
    try {
      guard.set('light');
      const tree = render(<Ink />);
      expect(inkOf(tree)).toBe(colors.light.content.primary);
      act(() => { guard.set('dark'); });
      expect(inkOf(tree)).toBe(colors.dark.content.primary); // no tree.update(): the consumer re-rendered
      expect(guard.liveSubscriptions()).toBe(1);
      unmountAll();
      expect(guard.liveSubscriptions()).toBe(0);
    } finally {
      guard.restore();
    }
  });

  it('forces Appearance.getColorScheme too, and restores it', () => {
    const before = RN.Appearance.getColorScheme;
    const guard = createFaceGuard();
    guard.install();
    try {
      guard.set('dark');
      expect(RN.Appearance.getColorScheme()).toBe('dark');
    } finally {
      guard.restore();
    }
    expect(RN.Appearance.getColorScheme).toBe(before);
  });
});
