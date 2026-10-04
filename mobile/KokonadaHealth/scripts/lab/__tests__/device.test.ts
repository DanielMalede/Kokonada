/// <reference types="node" />
import {
  applySession, applyShot, parseGfxFrames, parseNight, parseRefreshRate, parseSystemBars, parseWmDensity, parseWmSize,
  readDeviceFacts, restoreDevice, snapshotDevice,
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
