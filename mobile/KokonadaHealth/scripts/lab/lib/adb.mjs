// adb for the capture harness (OPS-100). Every call spawns adb with an argument ARRAY: no host
// shell joins or re-quotes anything, so Git Bash path mangling (/sdcard -> C:/...) and PowerShell
// encodings never touch it. Output is kept as bytes where it is binary (exec-out screencap).

import { spawn } from 'node:child_process';
import readline from 'node:readline';

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * @param {{ serial?: string|null, command?: string[] }} options
 *   command: the adb executable and any leading arguments (tests point it at a stand-in).
 */
export function createAdb({ serial = null, command = ['adb'] } = {}) {
  const [exe, ...lead] = command;
  const argv = (args) => [...lead, ...(serial ? ['-s', serial] : []), ...args];

  /** Runs adb once. Resolves with stdout (a string, or a Buffer with binary: true). */
  function run(args, { binary = false, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(exe, argv(args), { windowsHide: true });
      const out = [];
      const err = [];
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; child.kill(); }, timeoutMs);
      child.stdout.on('data', (c) => out.push(c));
      child.stderr.on('data', (c) => err.push(c));
      child.on('error', (e) => { clearTimeout(timer); reject(new Error(`adb ${args.join(' ')} could not start: ${e.message}`)); });
      child.on('close', (code) => {
        clearTimeout(timer);
        const stderr = Buffer.concat(err).toString('utf8').trim();
        if (timedOut) reject(new Error(`adb ${args.join(' ')} timed out after ${timeoutMs} ms`));
        else if (code !== 0) reject(new Error(`adb ${args.join(' ')} failed (exit ${code}): ${stderr}`));
        else resolve(binary ? Buffer.concat(out) : Buffer.concat(out).toString('utf8'));
      });
    });
  }

  /** A running `adb logcat` of the lab's JS log; listeners get one line each. */
  function logcat() {
    const child = spawn(exe, argv(['logcat', '-v', 'raw', '-s', 'ReactNativeJS:V']), { windowsHide: true });
    const listeners = new Set();
    let ended = false;
    const exited = new Promise((resolve) => child.on('close', () => { ended = true; resolve(); }));
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      for (const fn of [...listeners]) fn(line);
    });
    return {
      on(fn) { listeners.add(fn); return () => listeners.delete(fn); },
      async close() { if (!ended) child.kill(); await exited; },
      closed: () => ended,
    };
  }

  return {
    run,
    shell: (args, options) => run(['shell', ...args], options),
    execOut: (args, options) => run(['exec-out', ...args], { ...options, binary: true }),
    pull: (remote, local, options) => run(['pull', remote, local], options),
    logcat,
  };
}
