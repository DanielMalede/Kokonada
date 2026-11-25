import React from 'react';
import { Image } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { BUNDLED_FACES, type BundledFaceId } from '../faces.ts';
import { TypefaceProvider, useTypefaceFontMgr } from '../TypefaceProvider.tsx';
import type { FaceSources } from '../typefaces.ts';

// The provider's lifecycle, over a stateful fake of the part of Skia it builds with. The fake keeps what real Skia does
// where it matters here: Data.fromURI resolves bytes for a URI, a typeface is made from bytes that are a font (null from
// any other), a TypefaceFontProvider keeps each typeface under the family it is registered with, and every object counts
// its disposes. The faces' real bytes, matching and advances are typefaces.skia.test.ts's, in CanvasKit.
jest.mock('@shopify/react-native-skia', () => {
  const fake = {
    uris: [] as string[],
    managers: [] as Array<{ fonts: Array<{ family: string; from: string }>; disposed: number }>,
    pending: [] as Array<{ uri: string; resolve: (d: unknown) => void; reject: (e: Error) => void }>,
    hold: false,
  };
  const dataOf = (uri: string) => ({ uri, disposed: 0, dispose() { this.disposed += 1; } });
  const Skia = {
    Data: {
      fromURI: (uri: string) => {
        fake.uris.push(uri);
        if (!fake.hold) return Promise.resolve(dataOf(uri));
        return new Promise((resolve, reject) => fake.pending.push({ uri, resolve: () => resolve(dataOf(uri)), reject }));
      },
    },
    Typeface: {
      MakeFreeTypeFaceFromData: (data: { uri: string }) => (data.uri.includes('not-a-font') ? null : { from: data.uri, dispose() {} }),
    },
    TypefaceFontProvider: {
      Make: () => {
        const mgr = {
          fonts: [] as Array<{ family: string; from: string }>,
          disposed: 0,
          registerFont(typeface: { from: string }, family: string) { mgr.fonts.push({ family, from: typeface.from }); },
          dispose() { mgr.disposed += 1; },
        };
        fake.managers.push(mgr);
        return mgr;
      },
    },
  };
  return { Skia, __fake: fake };
});

type FakeManager = { fonts: Array<{ family: string; from: string }>; disposed: number };
const fake = () => jest.requireMock('@shopify/react-native-skia').__fake as {
  uris: string[];
  managers: FakeManager[];
  pending: Array<{ uri: string; resolve: () => void; reject: (e: Error) => void }>;
  hold: boolean;
};

/** Each bundled face as a Metro asset, the way require('…/assets/fonts/<id>.ttf') registers it on the device. */
// eslint-disable-next-line @react-native/no-deep-imports -- the registry a Metro asset is registered in; React Native exports it at no other path
const registry = require('react-native/Libraries/Image/AssetRegistry') as { registerAsset(a: object): number };
const asset = (name: string) =>
  registry.registerAsset({ __packager_asset: true, httpServerLocation: '/assets/assets/fonts', name, type: 'ttf', scales: [1], hash: name, fileSystemLocation: '/assets/fonts' });
const METRO = Object.fromEntries(BUNDLED_FACES.map((f) => [f.id, asset(f.id)])) as FaceSources<number>;

const seen: Array<unknown> = [];
function Reader() {
  seen.push(useTypefaceFontMgr());
  return null;
}

class Boundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    return this.state.error ? `caught: ${this.state.error.message}` : this.props.children;
  }
}

const flush = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });

beforeEach(() => {
  seen.length = 0;
  const f = fake();
  f.uris.length = 0;
  f.managers.length = 0;
  f.pending.length = 0;
  f.hold = false;
});

describe('useTypefaceFontMgr', () => {
  it('is undefined with no provider above it: the component falls back to the system font manager', () => {
    act(() => { ReactTestRenderer.create(<Reader />); });
    expect(seen).toEqual([undefined]);
  });
});

describe('TypefaceProvider', () => {
  it('reads each Metro asset by the URI React Native resolves it to, and gives the manager once every face is in', async () => {
    let root!: ReactTestRenderer.ReactTestRenderer;
    act(() => { root = ReactTestRenderer.create(<TypefaceProvider sources={METRO}><Reader /></TypefaceProvider>); });
    expect(seen).toEqual([undefined]);
    await flush();
    const expectedUris = BUNDLED_FACES.map((f) => Image.resolveAssetSource(METRO[f.id]).uri);
    expect(expectedUris.every((u) => /Heebo|Bellefair/.test(u))).toBe(true);
    expect(fake().uris).toEqual(expectedUris);
    expect(fake().managers).toHaveLength(1);
    const mgr = fake().managers[0];
    expect(mgr.fonts).toEqual(BUNDLED_FACES.map((f, i) => ({ family: f.family, from: expectedUris[i] })));
    expect(seen[seen.length - 1]).toBe(mgr);
    expect(mgr.disposed).toBe(0);
    act(() => root.unmount());
    expect(mgr.disposed).toBe(1);
  });

  it('takes the reader given, for sources that are not Metro assets', async () => {
    const files = Object.fromEntries(BUNDLED_FACES.map((f) => [f.id, `file:${f.id}`])) as FaceSources<string>;
    const read = jest.fn(async (s: string) => ({ uri: s, dispose() {} }) as never);
    act(() => { ReactTestRenderer.create(<TypefaceProvider sources={files} read={read}><Reader /></TypefaceProvider>); });
    await flush();
    expect(read.mock.calls.map((c) => c[0])).toEqual(BUNDLED_FACES.map((f) => `file:${f.id}`));
    expect(fake().managers[0].fonts.map((x) => x.from)).toEqual(BUNDLED_FACES.map((f) => `file:${f.id}`));
  });

  it('frees a manager that arrives after it unmounted, and never gives it', async () => {
    fake().hold = true;
    let root!: ReactTestRenderer.ReactTestRenderer;
    act(() => { root = ReactTestRenderer.create(<TypefaceProvider sources={METRO}><Reader /></TypefaceProvider>); });
    act(() => root.unmount());
    await act(async () => { for (const p of fake().pending) p.resolve(); });
    await flush();
    expect(fake().managers).toHaveLength(1);
    expect(fake().managers[0].disposed).toBe(1);
    expect(seen.every((m) => m === undefined)).toBe(true);
  });

  it('fails loudly, never quietly over the system face: a face that cannot load throws from the provider', async () => {
    const broken = { ...METRO, 'Heebo-Medium': asset('not-a-font') } as Record<BundledFaceId, number>;
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    let root!: ReactTestRenderer.ReactTestRenderer;
    act(() => { root = ReactTestRenderer.create(<Boundary><TypefaceProvider sources={broken}><Reader /></TypefaceProvider></Boundary>); });
    await flush();
    expect(root.toJSON()).toMatch(/^caught: Heebo-Medium \(\d+\) is not a font Skia can read$/);
    expect(fake().managers[0].disposed).toBe(1);
    error.mockRestore();
  });
});
