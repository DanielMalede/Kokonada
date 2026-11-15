/// <reference types="node" />
import {
  applySession, applyShot, parseDisplayColour, parseGfxFrames, parseGles, parseJank, parseNight, parseRefreshMode, parseRefreshRate,
  parseSystemBars, parseWmDensity, parseWmSize, readDeviceFacts, readRenderFacts, restoreDevice, snapshotDevice,
} from '../lib/device.mjs';
import { DUMPSYS_WINDOW, FakeDevice, NAV_BAR, SCREEN, STATUS_BAR } from '../__fixtures__/fakeDevice';

// OPS-100. The harness changes the owner's phone for a session (font scale, dark mode, animation
// scales, battery saver, stay-awake) and must leave it exactly as it found it. So it snapshots
// first, reads every change back as the device's own observation, and restores every setting even
// when one restore step fails.

describe('snapshot, apply and restore', () => {
  it('snapshots every setting it may change, a missing one as null, and the night mode', async () => {
    const d = new FakeDevice();
    expect(await snapshotDevice(d)).toEqual({
      settings: {
        'system/font_scale': '0.8',
        'global/window_animation_scale': '1.0',
        'global/transition_animation_scale': '1.0',
        'global/animator_duration_scale': '1.0',
        'global/low_power': '0',
        'global/stay_on_while_plugged_in': null,
      },
      night: 'yes',
    });
  });

  it('applies a shot and returns what the device then reports, not what was asked', async () => {
    const d = new FakeDevice();
    const observed = await applyShot(d, { fontScale: 1, night: 'no', animatorScale: 0, powerSave: true });
    expect(observed).toEqual({ fontScale: 1, night: 'no', animatorScales: { window: 0, transition: 0, animator: 0 }, powerSave: true });
    expect(d.batteryUnplugged).toBe(true); // battery saver turns itself off on USB power otherwise
    expect(d.settings.get('global/low_power')).toBe('1');
  });

  it('restores the phone exactly, a setting that was missing deleted again', async () => {
    const d = new FakeDevice();
    const before = d.state();
    const snapshot = await snapshotDevice(d);
    await applySession(d, { stayOn: true });
    await applyShot(d, { fontScale: 2, night: 'no', animatorScale: 0, powerSave: true });
    expect(d.state()).not.toEqual(before);
    expect(await restoreDevice(d, snapshot)).toEqual([]);
    expect(d.state()).toEqual(before);
  });

  it('keeps restoring after one step fails, and reports the failure', async () => {
    const d = new FakeDevice();
    const snapshot = await snapshotDevice(d);
    await applyShot(d, { fontScale: 2, night: 'no', animatorScale: 0 });
    d.failOn = /settings put system font_scale/;
    const failures = await restoreDevice(d, snapshot);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatch(/font_scale/);
    expect(d.night).toBe('yes'); // the steps after the failure still ran
    expect(d.settings.get('global/transition_animation_scale')).toBe('1.0');
  });
});

describe('reading the device', () => {
  it('reads the facts a manifest row needs', async () => {
    expect(await readDeviceFacts(new FakeDevice())).toEqual({
      model: 'SM-S906B', fingerprint: 'samsung/g0sxeea/g0s:16/BP2A/1:user/release-keys',
      width: SCREEN.width, height: SCREEN.height, density: 450, refreshRate: 120, forceDark: false, locale: 'he-IL',
    });
  });

  it('reports force-dark when the OS forces it, so the run can refuse', async () => {
    const d = new FakeDevice();
    d.props['debug.hwui.force_dark'] = 'true';
    expect((await readDeviceFacts(d)).forceDark).toBe(true);
  });

  it('prefers an override size and density, which is what the app is laid out at', () => {
    expect(parseWmSize('Physical size: 1080x2340\nOverride size: 720x1560\n')).toEqual({ width: 720, height: 1560 });
    expect(parseWmDensity('Physical density: 450\nOverride density: 320\n')).toBe(320);
    expect(() => parseWmSize('nothing')).toThrow(/wm size/);
  });

  it('reads night mode and the refresh rate', () => {
    expect(parseNight('Night mode: no\n')).toBe('no');
    expect(() => parseNight('?')).toThrow(/night/);
    expect(parseRefreshRate('renderFrameRate=120.0, vsyncRate=120.0')).toBe(120);
    expect(parseRefreshRate('no rate here')).toBeNull();
  });

  it('finds the visible system bars in dumpsys window, in the Android 14 and the Android 11 formats', () => {
    expect(parseSystemBars(DUMPSYS_WINDOW)).toEqual([
      { x: 0, y: 0, width: SCREEN.width, height: STATUS_BAR },
      { x: 0, y: SCREEN.height - NAV_BAR, width: SCREEN.width, height: NAV_BAR },
    ]);
    expect(parseSystemBars('InsetsSource type=ITYPE_STATUS_BAR frame=[0,0][1080,85] visible=true\nInsetsSource type=ITYPE_NAVIGATION_BAR frame=[0,2214][1080,2340] visible=false'))
      .toEqual([{ x: 0, y: 0, width: 1080, height: 85 }]);
  });

  it('refuses a dump with no bar at all rather than hashing the status bar as app content', () => {
    expect(() => parseSystemBars('WINDOW MANAGER WINDOWS')).toThrow(/system bar/);
  });

  it('counts the frames gfxinfo reports, and refuses output it cannot read', () => {
    expect(parseGfxFrames('Stats since: 1ns\nTotal frames rendered: 0\n')).toBe(0);
    expect(parseGfxFrames('Total frames rendered: 37')).toBe(37);
    expect(() => parseGfxFrames('No process found')).toThrow(/frames/);
  });
});

// B8-5a (F5): the GPU and the display's colour facts come from adb, never from the app (no Kotlin change). Each parser
// reads one documented line and fails closed: an absent, repeated-and-different or ambiguous line is null with a reason,
// never a guess. The formats are SurfaceFlinger's own (`GLES: %s, %s, %s`, `Current color mode: %s (%d)`); their reading on
// the emulator and the S22+ is the device session's first check.
const ADRENO = 'GLES: Qualcomm, Adreno (TM) 730, OpenGL ES 3.2 V@0615.65 (GIT@b4e5b4a, I1aa1e01a2d, 1658219498) (Date:07/19/22)';
const SWIFTSHADER = 'GLES: Google (Google Inc.), Android Emulator OpenGL ES Translator (Google SwiftShader), OpenGL ES 3.0 (OpenGL ES 3.0 SwiftShader 4.0.0.1)';
const SURFACE_FLINGER = [
  'Build configuration: [sf PRESENT_TIME_OFFSET=0 FORCE_HWC_FOR_RBG_TO_YUV=1]',
  'Wide-Color information:',
  'Device has wide color built-in display: 1',
  'Device uses color management: 1',
  'DisplayColorSetting: Managed',
  'Display 4619827259835644672 color modes:',
  '    ColorMode::NATIVE (0)',
  '    ColorMode::SRGB (7)',
  '    ColorMode::DISPLAY_P3 (9)',
  '    Current color mode: ColorMode::SRGB (7)',
  '',
  ' ------------RE GLES------------',
  'EGL implementation : 1.5',
  ADRENO,
].join('\n');

class RenderDevice extends FakeDevice {
  surfaceFlinger: string | Error = SURFACE_FLINGER;
  async shell(args: string[]): Promise<string> {
    if (args.join(' ') === 'dumpsys SurfaceFlinger') {
      this.commands.push('dumpsys SurfaceFlinger');
      if (this.surfaceFlinger instanceof Error) throw this.surfaceFlinger;
      return this.surfaceFlinger;
    }
    return super.shell(args);
  }
}

describe('the GPU, from dumpsys SurfaceFlinger (F5)', () => {
  it('reads the renderer (vendor and renderer, as SurfaceFlinger prints them) and the GLES version', () => {
    expect(parseGles(SURFACE_FLINGER)).toEqual({
      renderer: 'Qualcomm, Adreno (TM) 730', gles: 'OpenGL ES 3.2 V@0615.65 (GIT@b4e5b4a, I1aa1e01a2d, 1658219498) (Date:07/19/22)', reason: null,
    });
  });

  it('reads the emulator, whose renderer names OpenGL ES without the separator', () => {
    expect(parseGles(SWIFTSHADER)).toEqual({
      renderer: 'Google (Google Inc.), Android Emulator OpenGL ES Translator (Google SwiftShader)',
      gles: 'OpenGL ES 3.0 (OpenGL ES 3.0 SwiftShader 4.0.0.1)', reason: null,
    });
  });

  it('reads one GLES line printed twice the same', () => {
    expect(parseGles(`${ADRENO}\n${ADRENO}\n`).renderer).toBe('Qualcomm, Adreno (TM) 730');
  });

  it.each([
    ['no GLES line (a Vulkan RenderEngine prints none)', 'Build configuration: [sf]\nRenderEngine: skiavk', /no GLES line/],
    ['two different GLES lines', `${ADRENO}\n${SWIFTSHADER}`, /2 different GLES lines/],
    ['a GLES line without the version', 'GLES: Qualcomm, Adreno (TM) 730', /cannot split/],
    ['a GLES line with the version separator twice', 'GLES: Qualcomm, OpenGL ES 9, OpenGL ES 3.2', /cannot split/],
    ['an empty renderer', 'GLES: , OpenGL ES 3.2', /cannot split/],
    ['garbage', 'x\u0000\u0001 nothing', /no GLES line/],
    ['nothing at all', '', /no GLES line/],
  ])('is null with a reason for %s', (_label, text, why) => {
    const r = parseGles(text);
    expect([r.renderer, r.gles]).toEqual([null, null]);
    expect(r.reason).toMatch(why);
  });
});

describe('the display colour facts, from dumpsys SurfaceFlinger and dumpsys display (F5)', () => {
  it('reads the current colour mode as printed, and whether the built-in display is wide colour', () => {
    expect(parseDisplayColour(SURFACE_FLINGER)).toEqual({ colorMode: 'ColorMode::SRGB (7)', wideColor: true, reason: null });
    expect(parseDisplayColour('Device has wide color built-in display: 0\n    Current color mode: ColorMode::NATIVE (0)').wideColor).toBe(false);
  });

  it('is null with a reason for each fact it cannot read, and keeps the one it can', () => {
    expect(parseDisplayColour('Device has wide color built-in display: 1'))
      .toEqual({ colorMode: null, wideColor: true, reason: 'no "Current color mode" line in dumpsys SurfaceFlinger' });
    expect(parseDisplayColour('    Current color mode: ColorMode::SRGB (7)'))
      .toEqual({ colorMode: 'ColorMode::SRGB (7)', wideColor: null, reason: 'no "Device supports wide color" or "Device has wide color built-in display" line in dumpsys SurfaceFlinger' });
    const both = parseDisplayColour('garbage');
    expect([both.colorMode, both.wideColor]).toEqual([null, null]);
    expect(both.reason).toMatch(/Current color mode.*; .*wide color/);
  });

  it('is null with a reason when two displays report different colour modes, or the wide-colour line disagrees with itself', () => {
    const two = parseDisplayColour('    Current color mode: ColorMode::SRGB (7)\n    Current color mode: ColorMode::DISPLAY_P3 (9)\nDevice has wide color built-in display: 1');
    expect(two.colorMode).toBeNull();
    expect(two.wideColor).toBe(true);
    expect(two.reason).toMatch(/2 different/);
    const torn = parseDisplayColour('Device has wide color built-in display: 1\nDevice has wide color built-in display: 0\n    Current color mode: ColorMode::SRGB (7)');
    expect(torn.wideColor).toBeNull();
    expect(torn.reason).toMatch(/2 different/);
  });

  it('reads the active refresh mode (render and vsync rates) from dumpsys display, null with a reason when absent', () => {
    expect(parseRefreshMode('  mActiveSfDisplayMode=DisplayMode{id=1, width=1080, height=2340, renderFrameRate=120.0, vsyncRate=120.0}\n'))
      .toEqual({ refreshMode: 'renderFrameRate 120 Hz, vsyncRate 120 Hz', reason: null });
    expect(parseRefreshMode('mActiveSfDisplayMode=DisplayMode{id=2, renderFrameRate=60.0, vsyncRate=120.0}').refreshMode).toBe('renderFrameRate 60 Hz, vsyncRate 120 Hz');
    expect(parseRefreshMode('nothing')).toEqual({ refreshMode: null, reason: 'no mActiveSfDisplayMode with renderFrameRate or peakRefreshRate, and vsyncRate, in dumpsys display' });
    expect(parseRefreshMode('mActiveSfDisplayMode=DisplayMode{id=1, renderFrameRate=abc, vsyncRate=120.0}').refreshMode).toBeNull();
    const two = parseRefreshMode('mActiveSfDisplayMode=DisplayMode{renderFrameRate=60.0, vsyncRate=60.0}\nmActiveSfDisplayMode=DisplayMode{renderFrameRate=120.0, vsyncRate=120.0}');
    expect(two.refreshMode).toBeNull();
    expect(two.reason).toMatch(/2 different/);
  });

  it('reads the GPU and the display facts in one pass, for the whole run', async () => {
    expect(await readRenderFacts(new RenderDevice())).toEqual({
      gl: { renderer: 'Qualcomm, Adreno (TM) 730', gles: 'OpenGL ES 3.2 V@0615.65 (GIT@b4e5b4a, I1aa1e01a2d, 1658219498) (Date:07/19/22)', reason: null },
      display: { colorMode: 'ColorMode::SRGB (7)', wideColor: true, refreshMode: 'renderFrameRate 120 Hz, vsyncRate 120 Hz', reason: null },
    });
  });

  it('a dumpsys that fails is null facts with its reason, never a guess', async () => {
    const d = new RenderDevice();
    d.surfaceFlinger = new Error('adb shell dumpsys SurfaceFlinger failed (exit 1): denied');
    const facts = await readRenderFacts(d);
    expect(facts.gl).toEqual({ renderer: null, gles: null, reason: 'dumpsys SurfaceFlinger: adb shell dumpsys SurfaceFlinger failed (exit 1): denied' });
    expect(facts.display).toEqual({
      colorMode: null, wideColor: null, refreshMode: 'renderFrameRate 120 Hz, vsyncRate 120 Hz',
      reason: 'dumpsys SurfaceFlinger: adb shell dumpsys SurfaceFlinger failed (exit 1): denied',
    });
  });

  it('a display reason joins every unread fact', async () => {
    const d = new RenderDevice();
    d.surfaceFlinger = ADRENO;
    const shell = d.shell.bind(d);
    d.shell = async (args: string[]) => (args.join(' ') === 'dumpsys display' ? 'no mode here' : shell(args));
    const { display } = await readRenderFacts(d);
    expect([display.colorMode, display.wideColor, display.refreshMode]).toEqual([null, null, null]);
    expect(display.reason).toMatch(/Current color mode.*; .*wide color.*; .*mActiveSfDisplayMode/);
  });
});

describe('the jank summary gfxinfo prints (framestats, informational)', () => {
  it('reads the frames and the janky frames with their percentage', () => {
    expect(parseJank('Total frames rendered: 1200\nJanky frames: 36 (3.00%)\n')).toEqual({ frames: 1200, janky: 36, jankPercent: 3, reason: null });
    expect(parseJank('Total frames rendered: 0\nJanky frames: 0 (0.00%)\n')).toEqual({ frames: 0, janky: 0, jankPercent: 0, reason: null });
    expect(parseJank('Total frames rendered: 3\nJanky frames: 1 (33.33%)\n')).toEqual({ frames: 3, janky: 1, jankPercent: 33.33, reason: null });
  });

  it.each([
    ['no jank line', 'Total frames rendered: 10\n', /no "Janky frames" line/],
    ['no frame count', 'Janky frames: 3 (30.00%)\n', /no "Total frames rendered" line/],
    ['more janky frames than frames', 'Total frames rendered: 2\nJanky frames: 3 (150.00%)\n', /more janky frames than frames/],
    ['a percentage that is not the count over the frames', 'Total frames rendered: 100\nJanky frames: 3 (40.00%)\n', /does not match/],
    ['garbage', 'No process found for: com.x', /no "Total frames rendered" line/],
  ])('is null with a reason for %s', (_label, text, why) => {
    const r = parseJank(text);
    expect([r.frames, r.janky, r.jankPercent]).toEqual([null, null, null]);
    expect(r.reason).toMatch(why);
  });
});

// The dry run on the owner's phone (Galaxy S22+ SM-S906E, Android 16, Adreno 730, 2026-11-15): the lines each parser
// needs, copied verbatim from its dumpsys SurfaceFlinger and dumpsys display (no serial, no display id, nothing personal).
// Its spellings are not AOSP's: `Device supports wide color`, and an active mode with peakRefreshRate but no
// renderFrameRate, beside an mActiveRenderFrameRate line.
const S22_SURFACE_FLINGER = [
  'Wide-Color information:',
  'Device supports wide color: 1',
  'DisplayColorSetting: Managed',
  '    ColorMode::NATIVE (0)',
  '    ColorMode::SRGB (7)',
  '    ColorMode::DISPLAY_P3 (9)',
  '    Current color mode: ColorMode::SRGB (7)',
].join('\n');
const S22_ACTIVE_120 = '    mActiveSfDisplayMode=DisplayMode{id=0, width=1080, height=2340, xDpi=391.885, yDpi=393.615, peakRefreshRate=120.00001, vsyncRate=120.00001, appVsyncOffsetNanos=8333333, presentationDeadlineNanos=9233333, supportedHdrTypes=[2, 3, 4], group=1080}';
const S22_ACTIVE_60 = '    mActiveSfDisplayMode=DisplayMode{id=2, width=1080, height=2340, xDpi=391.885, yDpi=393.615, peakRefreshRate=60.000004, vsyncRate=60.000004, appVsyncOffsetNanos=16666666, presentationDeadlineNanos=17666666, supportedHdrTypes=[2, 3, 4], group=1080}';
// DisplayDeviceInfo prints the render rate with a space, not `=`: it is not the active mode's key.
const S22_DEVICE_INFO = '  DisplayDeviceInfo{1080 x 2340, modeId 1, renderFrameRate 120.00001, hasArrSupport false, supportedRefreshRates [120.00001, 96.00001, 60.000004]}';
const S22_DISPLAY_120 = [S22_DEVICE_INFO, '    mActiveModeId=1', S22_ACTIVE_120, '    mActiveRenderFrameRate=120.00001'].join('\n');
const S22_DISPLAY_60 = [S22_ACTIVE_60, '    mActiveRenderFrameRate=60.000004'].join('\n');

describe('the S22+ spellings (the dry run, 2026-11-15)', () => {
  it('reads wide colour from "Device supports wide color", as from the AOSP spelling', () => {
    expect(parseDisplayColour(S22_SURFACE_FLINGER)).toEqual({ colorMode: 'ColorMode::SRGB (7)', wideColor: true, reason: null });
    expect(parseDisplayColour('Device supports wide color: 0\n    Current color mode: ColorMode::SRGB (7)').wideColor).toBe(false);
  });

  it('takes both spellings when they agree, and neither when they disagree', () => {
    expect(parseDisplayColour('Device supports wide color: 1\nDevice has wide color built-in display: 1').wideColor).toBe(true);
    const torn = parseDisplayColour('Device supports wide color: 1\nDevice has wide color built-in display: 0');
    expect(torn.wideColor).toBeNull();
    expect(torn.reason).toMatch(/2 different wide-colour lines/);
    const none = parseDisplayColour('Device supports wide colour: yes');
    expect(none.wideColor).toBeNull();
    expect(none.reason).toMatch(/no "Device supports wide color" or "Device has wide color built-in display" line/);
  });

  it('reads the active mode\'s peakRefreshRate when it has no renderFrameRate, and says which key it read', () => {
    expect(parseRefreshMode(S22_DISPLAY_120)).toEqual({ refreshMode: 'peakRefreshRate 120.00001 Hz, vsyncRate 120.00001 Hz', reason: null });
    expect(parseRefreshMode(S22_DISPLAY_60).refreshMode).toBe('peakRefreshRate 60.000004 Hz, vsyncRate 60.000004 Hz');
    // renderFrameRate wins when the active mode has it
    expect(parseRefreshMode('mActiveSfDisplayMode=DisplayMode{id=1, peakRefreshRate=120.0, renderFrameRate=60.0, vsyncRate=120.0}').refreshMode)
      .toBe('renderFrameRate 60 Hz, vsyncRate 120 Hz');
    expect(parseRefreshMode('mActiveSfDisplayMode=DisplayMode{id=1, peakRefreshRate=120.0}').refreshMode).toBeNull();
  });

  it('device.refreshRate is the active render rate on the S22+, never a rate out of a list or another key', () => {
    expect(parseRefreshRate(S22_DISPLAY_120)).toBe(120.00001);
    expect(parseRefreshRate(S22_DISPLAY_60)).toBe(60.000004);
    // without mActiveRenderFrameRate, the active mode's peak rate
    expect(parseRefreshRate(S22_ACTIVE_120)).toBe(120.00001);
    // the DisplayDeviceInfo spelling and a lone peakRefreshRate outside the active mode are not read
    expect(parseRefreshRate(S22_DEVICE_INFO)).toBeNull();
    expect(parseRefreshRate('peakRefreshRate=120.00001')).toBeNull();
    // two different active rates: no guess
    expect(parseRefreshRate(`${S22_ACTIVE_120}\n${S22_ACTIVE_60}`)).toBeNull();
    expect(parseRefreshRate('mActiveRenderFrameRate=120.0\nmActiveRenderFrameRate=60.0')).toBeNull();
  });

  it('reads the S22+ render facts end to end', async () => {
    const d = new RenderDevice();
    d.surfaceFlinger = `${S22_SURFACE_FLINGER}\nGLES: Qualcomm, Adreno (TM) 730, OpenGL ES 3.2 V@0615.98 (GIT@0c393b63cf, I94e2bd5684, 1746191168) (Date:05/02/25)`;
    const shell = d.shell.bind(d);
    d.shell = async (args: string[]) => (args.join(' ') === 'dumpsys display' ? S22_DISPLAY_120 : shell(args));
    expect(await readRenderFacts(d)).toEqual({
      gl: { renderer: 'Qualcomm, Adreno (TM) 730', gles: 'OpenGL ES 3.2 V@0615.98 (GIT@0c393b63cf, I94e2bd5684, 1746191168) (Date:05/02/25)', reason: null },
      display: { colorMode: 'ColorMode::SRGB (7)', wideColor: true, refreshMode: 'peakRefreshRate 120.00001 Hz, vsyncRate 120.00001 Hz', reason: null },
    });
    expect((await readDeviceFacts(d)).refreshRate).toBe(120.00001);
  });
});
