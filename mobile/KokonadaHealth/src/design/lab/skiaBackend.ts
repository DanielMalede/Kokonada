// UI-276: which Skia backend draws the lab, as @shopify/react-native-skia itself answers on the device, for READY's
// `skiaBackend` and so for every capture manifest row (scripts/lab/lib/manifest.mjs). The manifest named only the
// lockfile's Skia version, and a model of the device's drawing (the fallback twin's ring coverage, UI-272) holds only for
// the backend it was validated on. Two runtime reads, in this order, and nothing assumed:
//   · Skia.hasDevice(): react-native-skia's JSI returns its build flag, true only in a build with the Graphite backend
//     (SK_GRAPHITE, cpp/api/JsiSkApi.h), so false is Ganesh;
//   · the GPU API Ganesh drives: the native texture of a 1x1 offscreen surface (getNativeTextureUnstable). On Android
//     every Ganesh surface comes from react-native-skia's OpenGLContext (2.6.9: android/cpp/rnskia-android), whose
//     texture names its GL target and texture name; one that names no GL texture is no GL backend (a CPU surface, a
//     Metal texture). The surface is disposed once read.
// A read that does not answer, or answers out of form, is null with the reason, never a guess; nothing here throws, so
// READY is always sent. adb cannot read this: the manifest's `gl` is SurfaceFlinger's RenderEngine and gfxinfo's
// Pipeline is HWUI's, and neither draws the lab's Skia canvas.

/** The backends a manifest row may name (scripts/lab/lib/manifest.mjs SKIA_BACKENDS; manifestSkiaBackend.test.ts pins them equal). */
export const SKIA_BACKENDS = ['ganesh-gl', 'graphite'] as const;
export type SkiaBackendName = (typeof SKIA_BACKENDS)[number];

/** READY's skiaBackend: the backend and how it was read, or no backend and why. */
export type SkiaBackendFact =
  | { readonly backend: SkiaBackendName; readonly readBy: string; readonly reason: null }
  | { readonly backend: null; readonly readBy: null; readonly reason: string };

/** The part of Skia the read asks: the real Skia, or a test's. Each member may be missing: a Skia without one says so. */
export type BackendSkia = {
  readonly hasDevice?: unknown;
  readonly Surface?: unknown;
} | null | undefined;

/** A reason short enough that READY stays one logcat line (protocol.ts MAX_LINE_BYTES). */
export const SKIA_BACKEND_MAX_REASON = 240;

const isObject = (v: unknown): v is Record<string, unknown> => (typeof v === 'object' || typeof v === 'function') && v !== null;
const isName = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;
/** A value as a reason names it, never by calling into it (a proxy or a host object may answer anything). */
const shown = (v: unknown): string => {
  if (v === null) return 'null';
  if (typeof v === 'object' || typeof v === 'function') return `a${typeof v === 'object' ? 'n' : ''} ${typeof v}`;
  if (typeof v === 'string') return JSON.stringify(v);
  return typeof v === 'symbol' ? 'a symbol' : String(v);
};
const messageOf = (e: unknown): string => (e instanceof Error ? e.message : shown(e));

const none = (reason: string): SkiaBackendFact => ({
  backend: null, readBy: null,
  reason: reason.length <= SKIA_BACKEND_MAX_REASON ? reason : `${reason.slice(0, SKIA_BACKEND_MAX_REASON - 1)}…`,
});

const GANESH = 'Skia.hasDevice() is false (Ganesh), and';

function read(skia: BackendSkia): SkiaBackendFact {
  const api = isObject(skia) ? skia : null;
  if (api === null || typeof api.hasDevice !== 'function') return none('react-native-skia has no Skia.hasDevice(), so it cannot say whether it is the Graphite build');
  let graphite: unknown;
  try {
    graphite = (api as { hasDevice(): unknown }).hasDevice();
  } catch (e) {
    return none(`Skia.hasDevice() threw: ${messageOf(e)}`);
  }
  if (graphite === true) return { backend: 'graphite', readBy: 'Skia.hasDevice() is true: react-native-skia was built with the Graphite backend (SK_GRAPHITE)', reason: null };
  if (graphite !== false) return none(`Skia.hasDevice() returned ${shown(graphite)}, not true or false`);

  const factory = api.Surface;
  if (!isObject(factory) || typeof factory.MakeOffscreen !== 'function') return none(`${GANESH} this Skia has no Surface.MakeOffscreen to show the GPU API Ganesh drives`);
  let surface: unknown;
  try {
    surface = (factory as { MakeOffscreen(width: number, height: number): unknown }).MakeOffscreen(1, 1);
  } catch (e) {
    return none(`${GANESH} Skia.Surface.MakeOffscreen(1, 1) threw: ${messageOf(e)}`);
  }
  if (!isObject(surface)) return none(`${GANESH} Skia.Surface.MakeOffscreen(1, 1) made no GPU surface`);
  try {
    if (typeof surface.getNativeTextureUnstable !== 'function') return none(`${GANESH} the offscreen surface has no getNativeTextureUnstable()`);
    let texture: unknown;
    try {
      texture = (surface as { getNativeTextureUnstable(): unknown }).getNativeTextureUnstable();
    } catch (e) {
      return none(`${GANESH} the offscreen surface's getNativeTextureUnstable() threw: ${messageOf(e)}`);
    }
    const target = isObject(texture) ? texture.glTarget : undefined;
    const name = isObject(texture) ? texture.glID : undefined;
    if (!isName(target) || !isName(name)) return none(`${GANESH} the offscreen surface's native texture names no GL texture (glTarget ${shown(target)}, glID ${shown(name)})`);
    return { backend: 'ganesh-gl', readBy: `${GANESH} a 1x1 Skia.Surface.MakeOffscreen surface's native texture is a GL texture on target 0x${target.toString(16)}`, reason: null };
  } finally {
    if (typeof surface.dispose === 'function') (surface as { dispose(): void }).dispose();
  }
}

/** The backend that draws the lab, read once at launch: never throws, and a read that does not answer is null with why. */
export function readSkiaBackend(skia: BackendSkia): SkiaBackendFact {
  try {
    return read(skia);
  } catch (e) {
    return none(`the backend read threw: ${messageOf(e)}`);
  }
}
