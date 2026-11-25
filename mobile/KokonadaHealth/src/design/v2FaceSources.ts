// The sources of the v2 typeface provider (F6): each bundled face's Metro asset, by face id. They live outside
// src/design/v2, which imports nothing outside itself, and are handed to it: <TypefaceProvider sources={V2_FACE_SOURCES}>
// above the page's Skia text. In a release build Metro writes each file as a raw resource the provider reads.

import type { FaceSources } from './v2/typeface/typefaces.ts';

export const V2_FACE_SOURCES: FaceSources<number> = {
  'Heebo-Light': require('../../assets/fonts/Heebo-Light.ttf'),
  'Heebo-Regular': require('../../assets/fonts/Heebo-Regular.ttf'),
  'Heebo-Medium': require('../../assets/fonts/Heebo-Medium.ttf'),
  'Heebo-SemiBold': require('../../assets/fonts/Heebo-SemiBold.ttf'),
  'Bellefair-Regular': require('../../assets/fonts/Bellefair-Regular.ttf'),
};
