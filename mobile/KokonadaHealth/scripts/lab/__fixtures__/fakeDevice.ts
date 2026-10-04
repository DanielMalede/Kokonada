/// <reference types="node" />
import fs from 'node:fs';

// A stateful stand-in for a phone behind adb, for the harness tests (OPS-100). It keeps real
// state: settings change when put and read back what was put, night mode and the battery override
// persist, logcat delivers lines to whoever listens, `am start` launches the lab (a scenario hook
// decides what the lab prints), screencap returns raw frames with AOSP's header, and every command
// is logged in order so a test can see what happened to the phone and when.

export type Extras = Record<string, string>;
export type Scenario = (extras: Extras, device: FakeDevice) => void;

export const SCREEN = { width: 40, height: 80 };
export const STATUS_BAR = 4;
export const NAV_BAR = 6;

/** A raw screencap: 16-byte header (w, h, format 1 = RGBA_8888, colour space), then RGBA rows. */
export function rawFrame(paint: (x: number, y: number) => number[], colorSpace = 1, width = SCREEN.width, height = SCREEN.height) {
  const header = Buffer.alloc(16);
  header.writeUInt32LE(width, 0);
  header.writeUInt32LE(height, 4);
  header.writeUInt32LE(1, 8);
  header.writeUInt32LE(colorSpace, 12);
  const body = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) body.set(paint(x, y), (y * width + x) * 4);
  return Buffer.concat([header, body]);
}

export const DUMPSYS_WINDOW = [
  'WINDOW MANAGER WINDOWS (dumpsys window windows)',
  `      InsetsSource id=3e4e0000 type=statusBars frame=[0,0][${SCREEN.width},${STATUS_BAR}] visible=true mFlags=[]`,
  `      InsetsSource id=3e4e0005 type=navigationBars frame=[0,${SCREEN.height - NAV_BAR}][${SCREEN.width},${SCREEN.height}] visible=true mFlags=[]`,
  '      InsetsSource id=3e4e0006 type=ime frame=[0,0][0,0] visible=false',
].join('\n');

export class FakeDevice {
  settings = new Map<string, string | null>([
    ['system/font_scale', '0.8'],
    ['global/window_animation_scale', '1.0'],
    ['global/transition_animation_scale', '1.0'],
    ['global/animator_duration_scale', '1.0'],
    ['global/low_power', '0'],
    ['global/stay_on_while_plugged_in', null],
  ]);
  night = 'yes';
  batteryUnplugged = false;
  commands: string[] = [];
  props: Record<string, string> = {
    'ro.product.model': 'SM-S906B',
    'ro.build.fingerprint': 'samsung/g0sxeea/g0s:16/BP2A/1:user/release-keys',
    'debug.hwui.force_dark': '',
    'persist.sys.locale': 'he-IL',
  };
  installedApk: Buffer | null = null;
  scenario: Scenario = () => {};
  frames: Array<() => Buffer> = [];
  grabs = 0;
  gfxFrames = 0;
  failOn: RegExp | null = null;
  private listeners = new Set<(line: string) => void>();
  /** Called with the command line before it runs, so a test can see the order of events. */
  onCommand: (line: string) => void = () => {};

  emit(line: string) {
    for (const fn of [...this.listeners]) fn(line);
  }

  // ---- the adb surface lib/adb.mjs exposes ----
  async run(args: string[]): Promise<string> {
    if (args[0] === 'shell') return this.shell(args.slice(1));
    throw new Error(`fake adb: unsupported ${args.join(' ')}`);
  }

  async shell(args: string[]): Promise<string> {
    const line = args.join(' ');
    this.onCommand(line);
    this.commands.push(line);
    if (this.failOn && this.failOn.test(line)) throw new Error(`adb shell ${line} failed (exit 1): fake failure`);
    const [cmd, ...rest] = args;
    if (cmd === 'settings') {
      const [verb, ns, key, value] = rest;
      const id = `${ns}/${key}`;
      if (verb === 'get') return `${this.settings.get(id) ?? 'null'}\n`;
      if (verb === 'put') { this.settings.set(id, value); return ''; }
      if (verb === 'delete') { this.settings.set(id, null); return 'Deleted 1 rows\n'; }
    }
    if (cmd === 'cmd' && rest[0] === 'uimode' && rest[1] === 'night') {
      if (rest[2]) this.night = rest[2];
      return `Night mode: ${this.night}\n`;
    }
    if (cmd === 'dumpsys' && rest[0] === 'battery') {
      this.batteryUnplugged = rest[1] === 'unplug';
      return '';
    }
    if (cmd === 'dumpsys' && rest[0] === 'window') return DUMPSYS_WINDOW;
    if (cmd === 'dumpsys' && rest[0] === 'display') return '  mActiveSfDisplayMode=DisplayMode{id=1, width=1080, height=2340, renderFrameRate=120.0, vsyncRate=120.0}\n';
    if (cmd === 'dumpsys' && rest[0] === 'gfxinfo') {
      if (rest[2] === 'reset') { this.gfxFrames = 0; return ''; }
      return `Applications Graphics Acceleration Info:\nStats since: 1ns\nTotal frames rendered: ${this.gfxFrames}\nJanky frames: 0 (0.00%)\n`;
    }
    if (cmd === 'svc' && rest.join(' ') === 'power stayon usb') { this.settings.set('global/stay_on_while_plugged_in', '2'); return ''; }
    if (cmd === 'getprop') return `${this.props[rest[0]] ?? ''}\n`;
    if (cmd === 'wm' && rest[0] === 'size') return `Physical size: ${SCREEN.width}x${SCREEN.height}\n`;
    if (cmd === 'wm' && rest[0] === 'density') return 'Physical density: 450\n';
    if (cmd === 'logcat' && rest[0] === '-c') return '';
    if (cmd === 'pm' && rest[0] === 'path') return this.installedApk ? `package:/data/app/~~x/${rest[1]}-y/base.apk\n` : '';
    if (cmd === 'am' && rest[0] === 'start') {
      const extras: Extras = {};
      for (let i = 0; i < rest.length; i += 1) if (rest[i] === '--es') { extras[rest[i + 1]] = rest[i + 2]; i += 2; }
      setTimeout(() => this.scenario(extras, this), 0);
      return 'Starting: Intent { cmp=x }\nStatus: ok\n';
    }
    throw new Error(`fake adb: unsupported shell ${line}`);
  }

  async execOut(args: string[]): Promise<Buffer> {
    this.commands.push(`exec-out ${args.join(' ')}`);
    if (args[0] !== 'screencap') throw new Error('fake adb: only screencap');
    const frame = this.frames[Math.min(this.grabs, this.frames.length - 1)];
    this.grabs += 1;
    return frame();
  }

  async pull(remote: string, local: string): Promise<string> {
    this.commands.push(`pull ${remote}`);
    if (!this.installedApk) throw new Error('fake adb: nothing to pull');
    fs.writeFileSync(local, this.installedApk);
    return '';
  }

  logcat() {
    const mine = new Set<(line: string) => void>();
    let closed = false;
    return {
      on: (fn: (line: string) => void) => { mine.add(fn); this.listeners.add(fn); return () => { mine.delete(fn); this.listeners.delete(fn); }; },
      close: async () => { for (const fn of mine) this.listeners.delete(fn); closed = true; },
      closed: () => closed,
    };
  }

  /** The settings, night mode and battery state, for before/after comparisons. */
  state() {
    return { settings: Object.fromEntries(this.settings), night: this.night, batteryUnplugged: this.batteryUnplugged };
  }
}
