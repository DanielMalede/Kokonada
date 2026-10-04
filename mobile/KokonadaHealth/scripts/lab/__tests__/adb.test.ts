/// <reference types="node" />
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createAdb } from '../lib/adb.mjs';

// OPS-100. The harness drives adb by spawning it with an argument ARRAY: no host shell joins or
// re-quotes anything, so neither Git Bash's path mangling nor PowerShell's encoding gets a say
// (the traps in the Windows evidence route). These tests run a real child process that has adb's
// shape (__fixtures__/fakeAdb.mjs), so spawning, bytes, exit codes and kills are the real thing.

const FAKE = path.resolve(__dirname, '../__fixtures__/fakeAdb.mjs');
const adb = (serial: string | null = 'SERIAL1') => createAdb({ serial, command: [process.execPath, FAKE] });

describe('createAdb', () => {
  it('passes the serial and every argument as its own argv entry, untouched', async () => {
    const out = await adb().shell(['settings', 'get', 'system', 'font_scale', '/sdcard/a b']);
    expect(JSON.parse(out)).toEqual({ serial: 'SERIAL1', args: ['shell', 'settings', 'get', 'system', 'font_scale', '/sdcard/a b'] });
  });

  it('omits -s when no serial is given', async () => {
    expect(JSON.parse(await adb(null).shell(['true'])).serial).toBeNull();
  });

  it('returns exec-out bytes exactly, all 256 values (a raw screencap is binary)', async () => {
    const bytes = await adb().execOut(['screencap']);
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect(Array.from(bytes)).toEqual(Array.from({ length: 256 }, (_, i) => i));
  });

  it('rejects a failing command with its exit code and stderr', async () => {
    await expect(adb().run(['fail'])).rejects.toThrow(/exit 3.*boom/);
  });

  it('kills a command that outlives its timeout, and rejects', async () => {
    await expect(adb().run(['slow'], { timeoutMs: 200 })).rejects.toThrow(/timed out after 200 ms/);
  });

  it('pulls a file', async () => {
    const local = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'adb-')), 'base.apk');
    await adb().pull('/data/app/x/base.apk', local);
    expect(fs.readFileSync(local, 'utf8')).toBe('pulled /data/app/x/base.apk');
  });

  it('streams logcat lines to listeners, and close() ends the process', async () => {
    const stream = adb().logcat();
    const seen: string[] = [];
    const off = stream.on((line: string) => seen.push(line));
    // Wait for the lines, not for a fixed time: under a full parallel jest run, starting the child
    // process alone can take longer than any fixed sleep would allow.
    const deadline = Date.now() + 15000;
    while (seen.length < 3 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 20));
    off();
    await stream.close();
    expect(seen).toEqual(['first line', 'KOKONADA_LAB READY {"run":"r","seq":0}', 'third line']);
    expect(stream.closed()).toBe(true);
  }, 20000);
});
