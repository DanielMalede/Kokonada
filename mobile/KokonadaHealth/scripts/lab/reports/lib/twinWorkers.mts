// Field twins drawn on worker threads (UI-239).
//
// A field twin is nearly all of lawParity's time: CanvasKit rasterising the field shader in WebAssembly, one thread per
// CanvasKit, about 44 s for a 1080 × 2400 stage at the full tier. A run has many distinct twins (24 in v1-field), each
// independent of the others, so a few workers, each with its own CanvasKit, draw them side by side while the report
// walks its rows. Each worker runs evidence.mts's own renderFieldTwin on the row's shot, as the main thread would: the
// same WebAssembly, the same calls, so the same bytes (reportsLawParityShare.test.ts holds a run's report, drawn on
// workers, to each row's own, drawn on the main thread). The twin comes back whole (its pixels, the inputs, the frame
// the law drew), and a twin that fails comes back as its error, its words and its kind (a report input error or not)
// kept, so the report says what it said when it drew the twin itself.
//
// This file is both: imported, the pool; run as a worker, the worker.

import os from 'node:os';
import { Worker, isMainThread, parentPort } from 'node:worker_threads';

import { EvidenceInputError, renderFieldTwin, type FieldShot, type FieldTwin } from './evidence.mts';

/** At most this many workers: each holds a CanvasKit, and the twins of one run seldom need more. */
const MAX_WORKERS = 4;

type Ask = { readonly id: number; readonly shot: FieldShot };
/** A failed twin as it crosses from a worker: its words, and whether it was a report input error. */
export interface Failure {
  readonly input: boolean;
  readonly message: string;
}
type Answer = { readonly id: number; readonly twin: FieldTwin } | { readonly id: number; readonly error: Failure };

/** What a worker sends back for a twin that threw. */
export function failureOf(e: unknown): Failure {
  return { input: e instanceof EvidenceInputError, message: e instanceof Error ? e.message : String(e) };
}

/** The error the report throws for it: the kind lawParity tells apart (an input error, or any other), and the words. */
export function errorFrom(f: Failure): Error {
  return f.input ? new EvidenceInputError(f.message) : new Error(f.message);
}

if (!isMainThread && parentPort) {
  const port = parentPort;
  port.on('message', async ({ id, shot }: Ask) => {
    let answer: Answer;
    try {
      answer = { id, twin: await renderFieldTwin(shot) };
    } catch (e) {
      answer = { id, error: failureOf(e) };
    }
    port.postMessage(answer, 'twin' in answer ? [answer.twin.rgba.buffer as ArrayBuffer] : []);
  });
}

/**
 * How many workers a run with this many distinct field twins gets: one per twin, up to MAX_WORKERS and the cores the
 * machine has beside the main thread; none (the main thread draws them) when that is fewer than two.
 */
export function twinWorkerCount(distinctFieldTwins: number): number {
  const n = Math.min(MAX_WORKERS, os.availableParallelism() - 1, distinctFieldTwins);
  return n >= 2 ? n : 0;
}

export interface FieldTwinWorkers {
  readonly size: number;
  /** The shot's field twin, drawn on the next free worker. */
  render(shot: FieldShot): Promise<FieldTwin>;
  /** Stops every worker; a twin not yet drawn fails. */
  close(): Promise<void>;
}

/**
 * `count` workers, each drawing one field twin at a time, the shots taken in the order they were asked for. A worker that
 * dies (an uncaught error, an exit) breaks the pool: every twin asked for and not yet drawn fails, and so does every
 * later one, saying so; nothing waits for a twin no worker will draw.
 */
export function fieldTwinWorkers(count: number): FieldTwinWorkers {
  type Waiting = { resolve: (t: FieldTwin) => void; reject: (e: Error) => void };
  const waiting = new Map<number, Waiting>();
  const queue: Ask[] = [];
  const idle: Worker[] = [];
  let broken: Error | null = null;
  let nextId = 0;
  const pump = () => {
    while (idle.length > 0 && queue.length > 0) idle.shift()!.postMessage(queue.shift()!);
  };
  const settle = (id: number, outcome: (w: Waiting) => void) => {
    const w = waiting.get(id);
    waiting.delete(id);
    if (w) outcome(w);
  };
  const breakPool = (why: string) => {
    if (broken) return;
    broken = new Error(`a twin worker stopped: ${why}`);
    queue.length = 0;
    for (const id of [...waiting.keys()]) settle(id, (w) => w.reject(broken!));
  };
  const workers = Array.from({ length: count }, () => {
    const worker = new Worker(new URL(import.meta.url));
    worker.on('message', (answer: Answer) => {
      if ('twin' in answer) settle(answer.id, (w) => w.resolve(answer.twin));
      else settle(answer.id, (w) => w.reject(errorFrom(answer.error)));
      idle.push(worker);
      pump();
    });
    worker.on('error', (e) => breakPool(e instanceof Error ? e.message : String(e)));
    worker.on('exit', (code) => breakPool(`exit ${code}`));
    idle.push(worker);
    return worker;
  });
  return {
    size: count,
    render: (shot) => new Promise<FieldTwin>((resolve, reject) => {
      if (broken) {
        reject(broken);
        return;
      }
      const id = nextId++;
      waiting.set(id, { resolve, reject });
      queue.push({ id, shot });
      pump();
    }),
    close: async () => {
      breakPool('closed');
      await Promise.all(workers.map((w) => w.terminate()));
    },
  };
}
