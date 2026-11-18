/// <reference types="node" />
// UI-261: a lab test unmounts every tree it mounts, and no timer the app armed outlives the test.
//
// The lab arms 10 s deadlines that its components clear on unmount: a surface's first draw in GrainScene and WitnessScene
// (RA-55) and every setting read of a LabRoot session (UI-241, settingRead.ts). A tree a test leaves mounted keeps its
// deadline running after the test file is done. On a runner with two CPUs jest's default is one worker, so it runs every
// suite in band, in its own process: the deadline fires there about 10 s later, React's act() warning and the render's
// import after teardown reach the test's frozen console, jest-runner sets process.exitCode = 1, and a run whose every test
// passed exits 1 (CI at 91d6940). Any such timer also holds jest's process open until it fires.
//
// labMounts() registers for the file it is called in: before each test, a watch on every real timer (Node's own Timeout
// resources, through async_hooks; a fake timer never creates one) armed through the app's source; after each test, it
// unmounts every tree the test passed to track(), then fails naming each of those timers still pending (neither fired
// nor cleared: Node marks a Timeout destroyed at once on either) and where it was armed.

import { createHook, type AsyncHook } from 'node:async_hooks';
import * as path from 'node:path';
import { act } from 'react-test-renderer';

const slash = (s: string) => s.replace(/\\/g, '/');
/** The app's source directory: a timer whose arming passed through it is the app's (its tests included). */
const SRC = `${slash(path.resolve(__dirname, '../../../..'))}/`;

/** The first frame of a stack in the app's source, or null if the stack never passed through it. */
export function appFrame(stack: string): string | null {
  for (const line of stack.split('\n')) {
    const at = slash(line);
    if (at.includes(SRC) && !at.includes('/node_modules/') && !at.includes('/__fixtures__/labMounts.')) return at.trim().replace(SRC, 'src/');
  }
  return null;
}

/** A Node Timeout as async_hooks hands it over: its delay, and whether it has fired or been cleared. */
interface Timeout {
  readonly _idleTimeout?: number;
  readonly _destroyed?: boolean;
}

export interface LabMounts {
  /** Unmounts this tree after the test (a tree the test unmounts itself is unmounted again, harmlessly). */
  track<T extends { unmount(): void }>(tree: T): T;
}

export function labMounts(): LabMounts {
  const trees: Array<{ unmount(): void }> = [];
  const armed: Array<{ timer: Timeout; site: string }> = [];
  let hook: AsyncHook | null = null;
  beforeEach(() => {
    armed.length = 0;
    hook = createHook({
      init(_asyncId, type, _trigger, resource) {
        if (type !== 'Timeout') return;
        const limit = Error.stackTraceLimit;
        Error.stackTraceLimit = 40;
        const site = appFrame(new Error().stack ?? '');
        Error.stackTraceLimit = limit;
        if (site !== null) armed.push({ timer: resource as Timeout, site });
      },
    }).enable();
  });
  afterEach(() => {
    try {
      act(() => {
        for (const tree of trees.splice(0)) tree.unmount();
      });
    } finally {
      // Never left on: a hook still enabled would watch every later test's timers, and every promise, in this process.
      hook?.disable();
      hook = null;
    }
    const left = armed.filter((t) => t.timer._destroyed !== true).map((t) => `a ${t.timer._idleTimeout} ms timer armed ${t.site}`);
    armed.length = 0;
    expect(left).toEqual([]);
  });
  return {
    track(tree) {
      trees.push(tree);
      return tree;
    },
  };
}
