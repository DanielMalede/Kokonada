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

export function parseRefreshRate(text) {
  const m = /renderFrameRate=([\d.]+)/.exec(text) ?? /mRefreshRate=([\d.]+)/.exec(text) ?? /refreshRate=([\d.]+)/.exec(text);
  return m ? Number(m[1]) : null;
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
