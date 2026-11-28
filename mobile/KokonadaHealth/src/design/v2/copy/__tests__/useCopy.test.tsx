/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { CopyError, createCopyPort, PSEUDO_LOCALE, type CopyPort, type CopySpec } from '../CopyPort.ts';
import { CopyProvider, useCopy } from '../useCopy.ts';

const { act } = ReactTestRenderer;

// useCopy is how a page or component reaches the port. Above every page, the composition root
// provides the one port it built; with no provider, the context's default is an adapter that throws
// on every read, in every build (D2-A, fail closed), so a page wired without copy cannot render.

const SPEC = {
  'shell.offline.title': { class: 'N' },
  'signIn.tagline': { class: 'R', budget: { chars: 48, lines: 2 } },
} as const satisfies CopySpec;

const EN = { 'shell.offline.title': 'You are offline' };
const enPort = createCopyPort({ spec: SPEC, catalogs: { en: EN }, mode: 'strict' });
const pseudoPort = createCopyPort({ spec: SPEC, catalogs: { en: EN }, mode: 'strict', locale: PSEUDO_LOCALE });

/** Renders a probe under `wrap` and records what useCopy gave it on each render. */
function render(wrap: (probe: React.ReactElement) => React.ReactElement) {
  const seen: CopyPort<typeof SPEC>[] = [];
  function Probe() {
    seen.push(useCopy<typeof SPEC>());
    return null;
  }
  let renderer!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    renderer = ReactTestRenderer.create(wrap(<Probe />));
  });
  return {
    latest: () => seen[seen.length - 1],
    update: (next: (probe: React.ReactElement) => React.ReactElement) => act(() => renderer.update(next(<Probe />))),
    unmount: () => act(() => renderer.unmount()),
  };
}

/** The CopyError `fn` throws; anything else (or nothing) fails the test. */
function copyErrorOf(fn: () => unknown): CopyError {
  try {
    fn();
  } catch (error) {
    if (error instanceof CopyError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected a CopyError, and nothing was thrown');
}

describe('useCopy', () => {
  it('gives the port the nearest CopyProvider holds', () => {
    const view = render((probe) => <CopyProvider port={enPort}>{probe}</CopyProvider>);
    expect(view.latest()).toBe(enPort);
    expect(view.latest().text('shell.offline.title')).toBe('You are offline');
    expect(view.latest().resolve('signIn.tagline')).toEqual({ kind: 'reserved', reason: 'regulated', budget: { chars: 48, lines: 2 } });
    view.unmount();
  });

  it('re-renders with the new port when the provider’s port changes, as the lab’s locale switch does', () => {
    const view = render((probe) => <CopyProvider port={enPort}>{probe}</CopyProvider>);
    view.update((probe) => <CopyProvider port={pseudoPort}>{probe}</CopyProvider>);
    expect(view.latest()).toBe(pseudoPort);
    expect(view.latest().locale).toBe('en-XA');
    expect(view.latest().text('shell.offline.title')).not.toBe('You are offline');
    view.unmount();
  });

  it('takes the nearest provider when two are nested', () => {
    const view = render((probe) => (
      <CopyProvider port={enPort}>
        <CopyProvider port={pseudoPort}>{probe}</CopyProvider>
      </CopyProvider>
    ));
    expect(view.latest()).toBe(pseudoPort);
    view.unmount();
  });

  it('types text() to the N keys of the spec it is given', () => {
    const view = render((probe) => <CopyProvider port={enPort}>{probe}</CopyProvider>);
    // @ts-expect-error an R key is not a text() key, through the hook as through the port.
    expect(copyErrorOf(() => view.latest().text('signIn.tagline')).code).toBe('regulated-key');
    view.unmount();
  });
});

describe('with no CopyProvider above it', () => {
  const g = globalThis as { __DEV__?: unknown };
  const saved = g.__DEV__;
  afterEach(() => {
    g.__DEV__ = saved;
  });

  it('every read throws no-provider: text, resolve and the locale', () => {
    const view = render((probe) => probe);
    const copy = view.latest();
    expect(copyErrorOf(() => copy.text('shell.offline.title')).code).toBe('no-provider');
    expect(copyErrorOf(() => copy.resolve('shell.offline.title')).code).toBe('no-provider');
    expect(copyErrorOf(() => copy.locale).code).toBe('no-provider');
    view.unmount();
  });

  it('throws in a release build too: a page wired without copy never renders a guess', () => {
    g.__DEV__ = false;
    const view = render((probe) => probe);
    expect(copyErrorOf(() => view.latest().text('shell.offline.title')).code).toBe('no-provider');
    view.unmount();
  });

  it('a component that reads copy fails to render, rather than rendering blank', () => {
    function Page() {
      return <>{useCopy<typeof SPEC>().text('shell.offline.title')}</>;
    }
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect(() =>
        act(() => {
          ReactTestRenderer.create(<Page />);
        }),
      ).toThrow(CopyError);
    } finally {
      spy.mockRestore();
    }
    let renderer!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      renderer = ReactTestRenderer.create(
        <CopyProvider port={enPort}>
          <Page />
        </CopyProvider>,
      );
    });
    expect(renderer.toJSON()).toBe('You are offline');
    act(() => renderer.unmount());
  });
});

// useCopy.ts is the React side of the port and nothing else: it imports react and the port, and no
// React Native module, so a page's copy never pulls the platform in through this seam.
describe('useCopy.ts imports react and the port only', () => {
  const SPECIFIER =
    /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/g;

  it('names exactly react and ./CopyPort.ts', () => {
    const source = fs.readFileSync(path.resolve(__dirname, '..', 'useCopy.ts'), 'utf8');
    const specifiers = Array.from(source.matchAll(SPECIFIER), (m) => m[2]);
    expect([...new Set(specifiers)].sort()).toEqual(['./CopyPort.ts', 'react']);
  });
});
