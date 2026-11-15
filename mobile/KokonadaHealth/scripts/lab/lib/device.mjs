// The phone, for the capture harness (OPS-100). The harness changes the owner's phone for a session
// and must leave it exactly as it found it:
//   · snapshotDevice  before any change (capture.mjs writes it to device-original-state.json first);
//   · applySession / applyShot  change it, and read every value back as the device's own observation;
//   · restoreDevice  puts every setting back, trying every step even when one fails, and reports.
// The parsers read adb's text output; their formats are pinned on fixtures, and their reading on the
// S22+ is part of the device smoke test.

const SETTINGS = [
  ['system', 'font_scale'],
  ['global', 'window_animation_scale'],
  ['global', 'transition_animation_scale'],
  ['global', 'animator_duration_scale'],
  ['global', 'low_power'],
  ['global', 'stay_on_while_plugged_in'],
];
const ANIMATION_SCALES = { window: 'window_animation_scale', transition: 'transition_animation_scale', animator: 'animator_duration_scale' };

const readSetting = async (adb, ns, key) => {
  const value = (await adb.shell(['settings', 'get', ns, key])).trim();
  return value === 'null' || value === '' ? null : value;
};

export function parseNight(text) {
  const m = /Night mode: (\w+)/.exec(text);
  if (!m) throw new Error(`cannot read the night mode from: ${text.trim()}`);
  return m[1];
}

/** Every setting the harness may change, and the night mode. */
export async function snapshotDevice(adb) {
  const settings = {};
  for (const [ns, key] of SETTINGS) settings[`${ns}/${key}`] = await readSetting(adb, ns, key);
  return { settings, night: parseNight(await adb.shell(['cmd', 'uimode', 'night'])) };
}

/** Battery saver as the device itself reports it (settings global low_power). */
export async function readPowerSave(adb) {
  return (await readSetting(adb, 'global', 'low_power')) === '1';
}

/** For the whole session: keep the screen on while on USB power. */
export async function applySession(adb, session = {}) {
  if (session.stayOn) await adb.shell(['svc', 'power', 'stayon', 'usb']);
}

/**
 * One shot's device state. Returns what the device then reports, which is what a manifest records.
 * @param {{ fontScale?: number, night?: 'yes'|'no', animatorScale?: number, powerSave?: boolean }} want
 */
export async function applyShot(adb, want = {}) {
  if (want.fontScale !== undefined) await adb.shell(['settings', 'put', 'system', 'font_scale', String(want.fontScale)]);
  if (want.night !== undefined) await adb.shell(['cmd', 'uimode', 'night', want.night]);
  if (want.animatorScale !== undefined) {
    for (const key of Object.values(ANIMATION_SCALES)) await adb.shell(['settings', 'put', 'global', key, String(want.animatorScale)]);
  }
  if (want.powerSave !== undefined) {
    // On USB power Android may switch battery saver off; an unplugged battery keeps it as set.
    await adb.shell(['dumpsys', 'battery', 'unplug']);
    await adb.shell(['settings', 'put', 'global', 'low_power', want.powerSave ? '1' : '0']);
  }
  const animatorScales = {};
  for (const [name, key] of Object.entries(ANIMATION_SCALES)) animatorScales[name] = Number(await readSetting(adb, 'global', key) ?? 1);
  return {
    fontScale: Number(await readSetting(adb, 'system', 'font_scale') ?? 1),
    night: parseNight(await adb.shell(['cmd', 'uimode', 'night'])),
    animatorScales,
    powerSave: (await readSetting(adb, 'global', 'low_power')) === '1',
  };
}

/** Puts the snapshot back. Every step is tried; the ones that failed are returned as sentences. */
export async function restoreDevice(adb, snapshot) {
  const failures = [];
  const attempt = async (what, args) => {
    try { await adb.shell(args); } catch (e) { failures.push(`${what}: ${e.message}`); }
  };
  for (const [id, value] of Object.entries(snapshot.settings)) {
    const [ns, key] = id.split('/');
    await attempt(`restore ${id}`, value === null ? ['settings', 'delete', ns, key] : ['settings', 'put', ns, key, value]);
  }
  await attempt('restore the night mode', ['cmd', 'uimode', 'night', snapshot.night]);
  await attempt('restore the battery', ['dumpsys', 'battery', 'reset']);
  return failures;
}

// ---- reading the device -------------------------------------------------------------------

export function parseWmSize(text) {
  const m = /Override size: (\d+)x(\d+)/.exec(text) ?? /Physical size: (\d+)x(\d+)/.exec(text);
  if (!m) throw new Error(`cannot read wm size from: ${text.trim()}`);
  return { width: Number(m[1]), height: Number(m[2]) };
}

export function parseWmDensity(text) {
  const m = /Override density: (\d+)/.exec(text) ?? /Physical density: (\d+)/.exec(text);
  if (!m) throw new Error(`cannot read wm density from: ${text.trim()}`);
  return Number(m[1]);
}

// The display's render rate, by the first source that prints one, in this order: the active mode's renderFrameRate
// (AOSP), DisplayManager's mActiveRenderFrameRate, the active mode's peakRefreshRate (the S22+ on Android 16 prints these
// two and no renderFrameRate in its mode), then the older renderFrameRate=, mRefreshRate= and refreshRate= keys. Each
// key is a whole word, so peakRefreshRate= is never read as refreshRate=. A source that prints two different rates is a
// null, never a guess.
const RATE_NUMBER = '(\\d+(?:\\.\\d+)?)(?=[,}\\s]|$)';
const RATE_SOURCES = [
  (text) => distinct(text, ACTIVE_MODE).map((body) => RATES.renderFrameRate.exec(body)?.[1]),
  (text) => distinct(text, new RegExp(`\\bmActiveRenderFrameRate=${RATE_NUMBER}`)),
  (text) => distinct(text, ACTIVE_MODE).map((body) => RATES.peakRefreshRate.exec(body)?.[1]),
  (text) => distinct(text, new RegExp(`(?:^|[\\s,{])renderFrameRate=${RATE_NUMBER}`)),
  (text) => distinct(text, new RegExp(`\\bmRefreshRate=${RATE_NUMBER}`)),
  (text) => distinct(text, new RegExp(`(?:^|[\\s,{])refreshRate=${RATE_NUMBER}`)),
];

/** The display's render rate in Hz from dumpsys display, or null when no source prints one, or one prints two. */
export function parseRefreshRate(text) {
  for (const source of RATE_SOURCES) {
    const rates = [...new Set(source(text).filter((v) => v !== undefined).map(Number))];
    if (rates.length === 1) return rates[0];
    if (rates.length > 1) return null;
  }
  return null;
}

const BAR_TYPES = new Set(['statusBars', 'navigationBars', 'captionBar', 'ITYPE_STATUS_BAR', 'ITYPE_NAVIGATION_BAR', 'ITYPE_CAPTION_BAR']);
const INSETS_SOURCE = /InsetsSource\b.*?\btype=(\w+).*?\bframe=\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\].*?\bvisible=(true|false)/;

/** The visible system bars in `dumpsys window`, as rects. Throws when there are none. */
export function parseSystemBars(text) {
  const bars = [];
  const seen = new Set();
  for (const line of text.split(/\r?\n/)) {
    const m = INSETS_SOURCE.exec(line);
    if (!m || !BAR_TYPES.has(m[1]) || m[6] !== 'true') continue;
    const [left, top, right, bottom] = m.slice(2, 6).map(Number);
    const rect = { x: left, y: top, width: right - left, height: bottom - top };
    const key = JSON.stringify(rect);
    if (rect.width > 0 && rect.height > 0 && !seen.has(key)) { seen.add(key); bars.push(rect); }
  }
  if (bars.length === 0) throw new Error('no visible system bar in dumpsys window: the app region cannot be told apart from them');
  return bars;
}

export function parseGfxFrames(text) {
  const m = /Total frames rendered: (\d+)/.exec(text);
  if (!m) throw new Error(`cannot read the frames gfxinfo rendered from: ${text.trim().slice(0, 200)}`);
  return Number(m[1]);
}

/**
 * The jank summary gfxinfo prints (framestats, informational): { frames, janky, jankPercent, reason }. All three null
 * with a reason when the summary is absent or does not hold together; never a guess.
 */
export function parseJank(text) {
  const none = (reason) => ({ frames: null, janky: null, jankPercent: null, reason });
  const total = /Total frames rendered: (\d+)/.exec(text);
  if (!total) return none('no "Total frames rendered" line in gfxinfo');
  const jank = /Janky frames: (\d+) \((\d+(?:\.\d+)?)%\)/.exec(text);
  if (!jank) return none('no "Janky frames" line in gfxinfo');
  const frames = Number(total[1]);
  const janky = Number(jank[1]);
  const jankPercent = Number(jank[2]);
  if (janky > frames) return none(`more janky frames than frames (${janky} of ${frames})`);
  const expected = frames === 0 ? 0 : (100 * janky) / frames;
  if (Math.abs(expected - jankPercent) > 0.01) return none(`the janky percentage ${jankPercent}% does not match ${janky} of ${frames} frames`);
  return { frames, janky, jankPercent, reason: null };
}

// ---- the GPU and the display's colour facts (B8-5a, F5) ------------------------------------------
// Read from adb, never from the app (no Kotlin change). Each parser reads lines SurfaceFlinger and DisplayManager print
// in AOSP and fails closed: an absent line, a line printed twice with different values (two displays) or a line it
// cannot split is null with a reason. Their reading on the emulator and the S22+ is the device session's first check.

/** The distinct values of a line pattern's first group, trimmed. */
const distinct = (text, pattern) => [...new Set(String(text).split(/\r?\n/).map((l) => pattern.exec(l)?.[1]?.trim()).filter((v) => v !== undefined))];

const GLES_LINE = /^\s*GLES: (.*)$/;
const GLES_VERSION = ', OpenGL ES ';

/** `GLES: <vendor>, <renderer>, <version>` in dumpsys SurfaceFlinger: { renderer, gles, reason }. */
export function parseGles(text) {
  const none = (reason) => ({ renderer: null, gles: null, reason });
  const lines = distinct(text, GLES_LINE);
  if (lines.length === 0) return none('no GLES line in dumpsys SurfaceFlinger (a Vulkan RenderEngine prints none)');
  if (lines.length > 1) return none(`${lines.length} different GLES lines in dumpsys SurfaceFlinger`);
  const line = lines[0];
  const parts = line.split(GLES_VERSION);
  const renderer = (parts[0] ?? '').trim();
  if (parts.length !== 2 || renderer === '' || parts[1].trim() === '') return none(`cannot split the GLES line into its renderer and its version: ${line.slice(0, 160)}`);
  return { renderer, gles: `OpenGL ES ${parts[1].trim()}`, reason: null };
}

const COLOR_MODE_LINE = /^\s*Current color mode: (.+)$/;
// AOSP's spelling, and the S22+'s on Android 16 (`Device supports wide color: 1`): both read, and they must agree.
const WIDE_COLOR_LINE = /^\s*Device (?:has wide color built-in display|supports wide color): ([01])\s*$/;

/** The current colour mode as SurfaceFlinger prints it, and whether the built-in display is wide colour. */
export function parseDisplayColour(text) {
  const reasons = [];
  const modes = distinct(text, COLOR_MODE_LINE);
  let colorMode = null;
  if (modes.length === 1) colorMode = modes[0];
  else reasons.push(modes.length === 0 ? 'no "Current color mode" line in dumpsys SurfaceFlinger' : `${modes.length} different "Current color mode" lines in dumpsys SurfaceFlinger (one per display)`);
  const wide = distinct(text, WIDE_COLOR_LINE);
  let wideColor = null;
  if (wide.length === 1) wideColor = wide[0] === '1';
  else reasons.push(wide.length === 0 ? 'no "Device supports wide color" or "Device has wide color built-in display" line in dumpsys SurfaceFlinger' : `${wide.length} different wide-colour lines in dumpsys SurfaceFlinger`);
  return { colorMode, wideColor, reason: reasons.length ? reasons.join('; ') : null };
}

const ACTIVE_MODE = /mActiveSfDisplayMode=DisplayMode\{([^}]*)\}/;
const RATES = {
  renderFrameRate: /(?:^|[\s,{])renderFrameRate=(\d+(?:\.\d+)?)(?=[,}\s]|$)/,
  peakRefreshRate: /(?:^|[\s,{])peakRefreshRate=(\d+(?:\.\d+)?)(?=[,}\s]|$)/,
  vsyncRate: /(?:^|[\s,{])vsyncRate=(\d+(?:\.\d+)?)(?=[,}\s]|$)/,
};

/**
 * The active display mode's render and vsync rates in dumpsys display: { refreshMode, reason }. The render rate is the
 * mode's renderFrameRate, or its peakRefreshRate when it prints none (the S22+ on Android 16), and the fact names the key
 * it was read from: `renderFrameRate 120 Hz, vsyncRate 120 Hz` or `peakRefreshRate 120.00001 Hz, vsyncRate 120.00001 Hz`.
 */
export function parseRefreshMode(text) {
  const modes = distinct(text, ACTIVE_MODE).map((body) => {
    const vsync = RATES.vsyncRate.exec(body);
    const key = RATES.renderFrameRate.test(body) ? 'renderFrameRate' : 'peakRefreshRate';
    const render = RATES[key].exec(body);
    return render && vsync ? `${key} ${Number(render[1])} Hz, vsyncRate ${Number(vsync[1])} Hz` : null;
  }).filter((m) => m !== null);
  const unique = [...new Set(modes)];
  if (unique.length === 0) return { refreshMode: null, reason: 'no mActiveSfDisplayMode with renderFrameRate or peakRefreshRate, and vsyncRate, in dumpsys display' };
  if (unique.length > 1) return { refreshMode: null, reason: `${unique.length} different active display modes in dumpsys display` };
  return { refreshMode: unique[0], reason: null };
}

/** The GPU and the display facts a manifest row records, read once for the run. A dumpsys that fails is its reason. */
export async function readRenderFacts(adb) {
  const dump = async (what) => {
    try { return { text: await adb.shell(['dumpsys', what]), reason: null }; } catch (e) { return { text: null, reason: `dumpsys ${what}: ${e.message}` }; }
  };
  const sf = await dump('SurfaceFlinger');
  const display = await dump('display');
  const gl = sf.text === null ? { renderer: null, gles: null, reason: sf.reason } : parseGles(sf.text);
  const colour = sf.text === null ? { colorMode: null, wideColor: null, reason: sf.reason } : parseDisplayColour(sf.text);
  const refresh = display.text === null ? { refreshMode: null, reason: display.reason } : parseRefreshMode(display.text);
  const reasons = [colour.reason, refresh.reason].filter((r) => r !== null);
  return {
    gl,
    display: { colorMode: colour.colorMode, wideColor: colour.wideColor, refreshMode: refresh.refreshMode, reason: reasons.length ? reasons.join('; ') : null },
  };
}

const prop = async (adb, name) => (await adb.shell(['getprop', name])).trim();

/** What a manifest row records about the device. */
export async function readDeviceFacts(adb) {
  const size = parseWmSize(await adb.shell(['wm', 'size']));
  return {
    model: await prop(adb, 'ro.product.model'),
    fingerprint: await prop(adb, 'ro.build.fingerprint'),
    width: size.width,
    height: size.height,
    density: parseWmDensity(await adb.shell(['wm', 'density'])),
    refreshRate: parseRefreshRate(await adb.shell(['dumpsys', 'display'])),
    forceDark: (await prop(adb, 'debug.hwui.force_dark')) === 'true',
    locale: (await prop(adb, 'persist.sys.locale')) || (await prop(adb, 'ro.product.locale')) || 'und',
  };
}
