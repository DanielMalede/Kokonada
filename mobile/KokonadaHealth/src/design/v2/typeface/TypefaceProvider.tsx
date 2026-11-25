// The typeface provider (F6): loads the bundled faces into one Skia font manager (typefaces.ts) and gives it to the Skia
// text below it (RimLabels) through useTypefaceFontMgr.
//
//   · Until every face is in, and with no provider above, the hook gives undefined: the component then asks the system
//     font manager, which on Android has no Heebo and draws no glyph. So the page mounts the provider above its Skia text.
//   · A face that cannot load throws from the provider, in render, to the nearest error boundary: never quietly over the
//     system face, the defect the provider ends.
//   · It loads once per mount (the sources and the reader are read at mount), frees a manager that arrives after it
//     unmounted, and frees its own on unmount.
//   · On the device each source is the face's Metro asset, require('…/assets/fonts/<id>.ttf'): it is read from the URI React
//     Native resolves it to (a raw resource in a release build, the packager's URL in a debug one), as Skia's own useFonts
//     reads one. The sources are passed in: src/design/v2 imports nothing outside itself.

import React, { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Image } from 'react-native';
import { Skia, type SkFontMgr, type SkTypefaceFontProvider } from '@shopify/react-native-skia';
import { loadTypefaces, type FaceSources, type ReadFace } from './typefaces.ts';

const TypefaceContext = createContext<SkFontMgr | undefined>(undefined);

/** Reads a face's Metro asset from the URI React Native resolves it to. */
const readAsset: ReadFace<number> = (source) => Skia.Data.fromURI(Image.resolveAssetSource(source).uri);

export type TypefaceProviderProps<S> = { readonly children?: ReactNode } & (
  | { readonly sources: FaceSources<number>; readonly read?: undefined }
  | { readonly sources: FaceSources<S>; readonly read: ReadFace<S> }
);

export function TypefaceProvider<S>(props: TypefaceProviderProps<S>) {
  const { children } = props;
  const [mgr, setMgr] = useState<SkTypefaceFontProvider | undefined>(undefined);
  const [error, setError] = useState<Error | null>(null);
  const first = useRef(props);

  useEffect(() => {
    let live = true;
    let held: SkTypefaceFontProvider | undefined;
    const p = first.current;
    const loading = p.read === undefined ? loadTypefaces({ Skia }, p.sources, readAsset) : loadTypefaces({ Skia }, p.sources, p.read);
    loading.then(
      (made) => {
        if (!live) {
          made.dispose();
          return;
        }
        held = made;
        setMgr(made);
      },
      (e: unknown) => {
        if (live) setError(e instanceof Error ? e : new Error(String(e)));
      },
    );
    return () => {
      live = false;
      held?.dispose();
    };
  }, []);

  if (error !== null) throw error;
  return <TypefaceContext.Provider value={mgr}>{children}</TypefaceContext.Provider>;
}

/** The bundled faces' font manager from the provider above, once every face is in; undefined before, or with none above. */
export function useTypefaceFontMgr(): SkFontMgr | undefined {
  return useContext(TypefaceContext);
}
