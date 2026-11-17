// QA-111: the both-faces harness. Every v2 render test runs in light AND dark, and a test that never
// sets a face fails.
//
// The preset replaces react-native's useColorScheme with jest.fn(() => 'light')
// (@react-native/jest-preset/jest/mocks/useColorScheme.js:13), so an unforced render only ever sees
// the light face; the ConsentSheet cross-face bug (1.08:1) hid there. This harness captures the
// preset's implementation, installs its own, and restores the captured one by identity: no spyOn
// (QA-112). Its useColorScheme behaves like RN 0.86's real hook, a useSyncExternalStore over the
// colour-scheme source, so a mid-session face change re-renders mounted consumers.

import { useSyncExternalStore } from 'react';
import * as RN from 'react-native';
import { Patcher } from './patch';

export type Face = 'light' | 'dark';
export const FACES: readonly Face[] = ['light', 'dark'];

export const NO_FACE = 'QA-111: the colour scheme was read before a face was set';

/** The snapshot while the OS reports no display mode (MB-165, DEC-034): the hooks answer null. */
const UNREPORTED = 'unreported';

/** The one colour-scheme source while a guard is installed (platform.ts's Appearance fake reads it too). */
export const faceSource = {
  face: null as Face | null,
  /** True after setUnreported(): the OS reports no scheme on purpose (face stays null). */
  unreported: false,
  listeners: new Set<() => void>(),
  installed: false,
  subscribe(listener: () => void): () => void {
    faceSource.listeners.add(listener);
    return () => { faceSource.listeners.delete(listener); };
  },
  set(face: Face): void {
    faceSource.face = face;
    faceSource.unreported = false;
    for (const l of [...faceSource.listeners]) l();
  },
  setUnreported(): void {
    faceSource.face = null;
    faceSource.unreported = true;
    for (const l of [...faceSource.listeners]) l();
  },
  snapshot: (): Face | typeof UNREPORTED | null => (faceSource.unreported ? UNREPORTED : faceSource.face),
};

export interface FaceGuard {
  install(): void;
  restore(): void;
  set(face: Face): void;
  /**
   * The OS reports no display mode (DEC-034: production shows the dark face): useColorScheme() and
   * Appearance.getColorScheme() answer null. Counts as a face set for the per-test check, but toward
   * neither face of the both-faces coverage.
   */
  setUnreported(): void;
  /** The forced face; null before a face is set and while the scheme is unreported. */
  current(): Face | null;
  /** Renders that read the scheme, per face, since this guard was created. */
  readsByFace(): Record<Face, number>;
  /** Mounted consumers subscribed to the scheme (each useColorScheme() call site while mounted). */
  liveSubscriptions(): number;
  /** True once set() ran since the last install(). */
  faceSetSinceInstall(): boolean;
}

export function createFaceGuard(): FaceGuard {
  const hook = RN.useColorScheme as unknown as jest.Mock;
  const patcher = new Patcher();
  const reads: Record<Face, number> = { light: 0, dark: 0 };
  let preset: ((...args: unknown[]) => unknown) | undefined;
  let faceSet = false;

  const useForcedScheme = (): Face | null => {
    const face = useSyncExternalStore(faceSource.subscribe, faceSource.snapshot);
    if (face === UNREPORTED) return null; // not a face: no read counts toward coverage
    if (face === null) throw new Error(`${NO_FACE}: call faces.set('light' | 'dark') or use faces.each().`);
    reads[face] += 1;
    return face;
  };

  const guard: FaceGuard = {
    install() {
      if (!jest.isMockFunction(hook)) throw new Error('QA-111: react-native useColorScheme is not the preset mock; the face harness cannot capture it.');
      if (faceSource.installed) throw new Error('QA-111: a face guard is already installed.');
      preset = hook.getMockImplementation();
      if (typeof preset !== 'function' || preset() !== 'light') {
        throw new Error('QA-111: the preset useColorScheme was mutated before the face harness captured it (a leaked jest.spyOn(...).mockReturnValue, OPS-017).');
      }
      // RA-235-10: a queued mockReturnValueOnce / mockImplementationOnce outranks mockImplementation,
      // so a leaked one would answer one read past the guard. Reset the queue, then install.
      hook.mockReset();
      hook.mockImplementation(useForcedScheme);
      patcher.set(RN.Appearance, 'getColorScheme', () => {
        if (faceSource.unreported) return null;
        if (faceSource.face === null) throw new Error(`${NO_FACE} (Appearance.getColorScheme)`);
        return faceSource.face;
      });
      faceSource.face = null;
      faceSource.unreported = false;
      faceSource.installed = true;
      faceSet = false;
    },
    restore() {
      if (preset) {
        hook.mockReset(); // a once-value queued while installed must not reach the next test either
        hook.mockImplementation(preset);
      }
      preset = undefined;
      patcher.restore();
      faceSource.face = null;
      faceSource.unreported = false;
      faceSource.installed = false;
    },
    set(face: Face) {
      if (!faceSource.installed) throw new Error('QA-111: set() before install().');
      faceSet = true;
      faceSource.set(face);
    },
    setUnreported() {
      if (!faceSource.installed) throw new Error('QA-111: setUnreported() before install().');
      faceSet = true;
      faceSource.setUnreported();
    },
    current: () => faceSource.face,
    readsByFace: () => ({ ...reads }),
    liveSubscriptions: () => faceSource.listeners.size,
    faceSetSinceInstall: () => faceSet,
  };
  return guard;
}

export interface FaceGuardHooks {
  beforeEach(fn: () => void): void;
  afterEach(fn: () => void): void;
  afterAll(fn: () => void): void;
}

export interface FaceGuardOptions {
  /** Fail a test that never sets a face (default true). */
  requireFacePerTest?: boolean;
  /** Fail the suite (the enclosing describe) unless both faces were rendered (default true). */
  requireBothFaces?: boolean;
}

export interface Faces {
  set(face: Face): void;
  /** The OS reports no scheme (see FaceGuard.setUnreported). */
  setUnreported(): void;
  current(): Face | null;
  /** describe.each over both faces, each test forced to its face before it runs. */
  each(body: (face: Face) => void): void;
  readsByFace(): Record<Face, number>;
  liveSubscriptions(): number;
}

const jestHooks: FaceGuardHooks = {
  beforeEach: (fn) => beforeEach(fn),
  afterEach: (fn) => afterEach(fn),
  afterAll: (fn) => afterAll(fn),
};

/**
 * Install the face guard around every test of the enclosing describe (or file): before each test it
 * captures the preset and forces "no face yet"; after each it restores the preset and fails the test
 * if no face was set; after all it fails the suite unless both faces were rendered.
 */
export function useFaceGuard(options: FaceGuardOptions = {}, hooks: FaceGuardHooks = jestHooks): Faces {
  const { requireFacePerTest = true, requireBothFaces = true } = options;
  const guard = createFaceGuard();
  hooks.beforeEach(() => guard.install());
  hooks.afterEach(() => {
    const wasSet = guard.faceSetSinceInstall();
    guard.restore();
    if (requireFacePerTest && !wasSet) {
      throw new Error("QA-111: this test never set a face. Force one with faces.set('light' | 'dark'), or run the suite under faces.each().");
    }
  });
  hooks.afterAll(() => {
    if (!requireBothFaces) return;
    const reads = guard.readsByFace();
    const missing = FACES.filter((f) => reads[f] === 0);
    if (missing.length === 1) throw new Error(`QA-111: this suite rendered only the ${FACES.find((f) => !missing.includes(f))} face; run it under faces.each().`);
    if (missing.length === 2) throw new Error('QA-111: this suite rendered neither face (nothing read the colour scheme).');
  });
  return {
    set: (face) => guard.set(face),
    setUnreported: () => guard.setUnreported(),
    current: () => guard.current(),
    each(body) {
      describe.each(FACES as Face[])('%s face', (face) => {
        beforeEach(() => guard.set(face));
        body(face);
      });
    },
    readsByFace: () => guard.readsByFace(),
    liveSubscriptions: () => guard.liveSubscriptions(),
  };
}
