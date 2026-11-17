/// <reference types="node" />
// UI-239: lawParity renders each law twin once per distinct input and shares it across the rows that need it (a shot's
// repeats, and any rows whose twin inputs are the same), instead of once per row. The twin is a pure function of the
// shot minus the capture's own identity (its name, PNG file and sha256), so the key is every other field of the shot:
// the scene, direction, face, hero, tier, render scale, fixed frame time, stage, density (px per dp), font scale and the
// region. A key on fewer inputs, or one shared across faces or kinds, would hand a row a twin that is not its own.
// A twin is held only until the last row that uses it, so a long run never holds more than the twins still to be used.
//
// Here with a stateful fake renderer that counts its renders; the end-to-end proof that the report is the one each row
// would get alone is in reportsLawParityShare.test.ts.

import { shareTwins, twinKey } from '../reports/lib/twinShare.mjs';

type Shot = Record<string, unknown>;
type Job = { kind: 'field' | 'fallback'; shot: Shot };

const FIELD: Shot = {
  name: 'dark-one-joy-full.1', scene: 'field.abyss.dark.one.joy.full', file: 'dark-one-joy-full.1.png', sha256: 'a'.repeat(64),
  region: { x: 0, y: 63, width: 1080, height: 2289 }, direction: 'abyss', face: 'dark', hero: 'one.joy', tier: 'full',
  renderScale: 0.5, pxPerDp: 2.625, fontScale: 1, tMs: 11000, stage: { x: 0, y: -63, width: 1080, height: 2400 },
};
const FALLBACK: Shot = {
  name: 'fb-dark-one-c.1', scene: 'fallback.abyss.dark.one.C.right', file: 'fb-dark-one-c.1.png', sha256: 'b'.repeat(64),
  region: { x: 0, y: 63, width: 1080, height: 2289 }, direction: 'abyss', face: 'dark', fallbackScene: 'one.C.right',
  pxPerDp: 2.625, fontScale: 1, stage: { x: 0, y: -63, width: 1080, height: 2400 },
};
/** The same shot captured again: another name, PNG and hash, every twin input the same. */
const repeatOf = (s: Shot, n: number): Shot => ({ ...s, name: `${String(s.name).replace(/\.\d+$/, '')}.${n}`, file: `${n}.png`, sha256: String(n).repeat(64).slice(0, 64) });

/** A renderer that draws a new twin object per call and records each call's row. */
function fakeRenderer() {
  const calls: string[] = [];
  const render = async (job: Job) => {
    calls.push(String(job.shot.name));
    return { drawnFor: job.shot.name, kind: job.kind, key: twinKey(job.kind, job.shot) };
  };
  return { calls, render };
}

async function all(jobs: Job[], render: (j: Job) => Promise<unknown>) {
  const share = shareTwins(jobs, render);
  const twins: unknown[] = [];
  const held: number[] = [];
  for (let i = 0; i < jobs.length; i++) {
    twins.push(await share.twinAt(i));
    held.push(share.held());
  }
  return { twins, held };
}

describe('twinKey: every input of the twin, none of the capture\'s identity', () => {
  it('a repeat (another name, file and sha256) has the same key', () => {
    expect(twinKey('field', repeatOf(FIELD, 2))).toBe(twinKey('field', FIELD));
    expect(twinKey('fallback', repeatOf(FALLBACK, 2))).toBe(twinKey('fallback', FALLBACK));
  });

  const fieldChanges: Array<[string, Shot]> = [
    ['face', { face: 'light' }],
    ['scene', { scene: 'field.abyss.dark.one.joy.policy' }],
    ['direction', { direction: 'other' }],
    ['hero', { hero: 'three' }],
    ['tier', { tier: 'low' }],
    ['renderScale', { renderScale: 0.33 }],
    ['frame time', { tMs: 11001 }],
    ['density', { pxPerDp: 2.75 }],
    ['font scale', { fontScale: 1.3 }],
    ['stage width', { stage: { x: 0, y: -63, width: 1079, height: 2400 } }],
    ['stage height', { stage: { x: 0, y: -63, width: 1080, height: 2399.5 } }],
    ['stage place', { stage: { x: 0, y: -62, width: 1080, height: 2400 } }],
    ['region', { region: { x: 0, y: 64, width: 1080, height: 2288 } }],
  ];
  it.each(fieldChanges)('a field shot with another %s has another key', (_, change) => {
    expect(twinKey('field', { ...FIELD, ...change })).not.toBe(twinKey('field', FIELD));
  });

  it.each([['face', { face: 'light' }], ['scene', { fallbackScene: 'rest' }], ['density', { pxPerDp: 3 }], ['font scale', { fontScale: 2 }], ['stage', { stage: { x: 0, y: -63, width: 1080, height: 2340 } }]] as Array<[string, Shot]>)(
    'a fallback shot with another %s has another key', (_, change) => {
      expect(twinKey('fallback', { ...FALLBACK, ...change })).not.toBe(twinKey('fallback', FALLBACK));
    },
  );

  it('a field and a fallback twin never share a key, even on the same fields', () => {
    expect(twinKey('field', FIELD)).not.toBe(twinKey('fallback', FIELD));
  });

  it('a field the key does not know yet is in the key: it is built from the shot, not from a list of its inputs', () => {
    expect(twinKey('field', { ...FIELD, grain: 0.5 })).not.toBe(twinKey('field', { ...FIELD, grain: 0.25 }));
  });

  it('values JSON would spell alike are different keys: -0 and 0, 1 and "1", NaN and null', () => {
    expect(twinKey('field', { ...FIELD, tMs: -0 })).not.toBe(twinKey('field', { ...FIELD, tMs: 0 }));
    expect(twinKey('field', { ...FIELD, fontScale: '1' })).not.toBe(twinKey('field', FIELD));
    expect(twinKey('field', { ...FIELD, fontScale: NaN })).not.toBe(twinKey('field', { ...FIELD, fontScale: null }));
  });

  it('the order the shot\'s fields were written in does not matter', () => {
    const reversed = Object.fromEntries(Object.entries(FIELD).reverse());
    expect(twinKey('field', reversed)).toBe(twinKey('field', FIELD));
    expect(twinKey('field', { ...FIELD, stage: { height: 2400, width: 1080, y: -63, x: 0 } })).toBe(twinKey('field', FIELD));
  });
});

describe('shareTwins: one render per distinct twin, shared across rows, held only until its last use', () => {
  it('a shot\'s repeats share one render, and each row gets that twin', async () => {
    const f = fakeRenderer();
    const jobs: Job[] = [{ kind: 'field', shot: FIELD }, { kind: 'field', shot: repeatOf(FIELD, 2) }, { kind: 'field', shot: repeatOf(FIELD, 3) }];
    const { twins } = await all(jobs, f.render);
    expect(f.calls).toEqual(['dark-one-joy-full.1']);
    expect(twins[1]).toBe(twins[0]);
    expect(twins[2]).toBe(twins[0]);
  });

  it('rows whose twins differ in any one input each get their own render', async () => {
    const f = fakeRenderer();
    const shots = [FIELD, { ...FIELD, name: 'b', face: 'light' }, { ...FIELD, name: 'c', tMs: 12000 }, { ...FIELD, name: 'd', fontScale: 1.3 },
      { ...FIELD, name: 'e', pxPerDp: 2.75 }, { ...FIELD, name: 'f', tier: 'still' }, { ...FIELD, name: 'g', stage: { x: 0, y: -63, width: 1000, height: 2400 } }];
    const jobs: Job[] = [...shots.map((shot) => ({ kind: 'field' as const, shot })), { kind: 'fallback', shot: FALLBACK }, { kind: 'fallback', shot: { ...FALLBACK, name: 'h', face: 'light' } }];
    const { twins } = await all(jobs, f.render);
    expect(f.calls).toEqual(['dark-one-joy-full.1', 'b', 'c', 'd', 'e', 'f', 'g', 'fb-dark-one-c.1', 'h']);
    expect(new Set(twins).size).toBe(jobs.length);
    twins.forEach((t, i) => expect(t).toMatchObject({ drawnFor: jobs[i].shot.name, kind: jobs[i].kind }));
  });

  it('shares across rows that are not adjacent, and drops a twin after the last row that uses it', async () => {
    const f = fakeRenderer();
    const A = FIELD;
    const B = { ...FIELD, name: 'B.1', face: 'light' };
    const jobs: Job[] = [...[A, B, repeatOf(A, 2), repeatOf(B, 2)].map((shot) => ({ kind: 'field' as const, shot })), { kind: 'fallback', shot: FALLBACK }];
    const { twins, held } = await all(jobs, f.render);
    expect(f.calls).toEqual(['dark-one-joy-full.1', 'B.1', 'fb-dark-one-c.1']);
    expect([twins[2] === twins[0], twins[3] === twins[1]]).toEqual([true, true]);
    // After row 0: A (row 2 needs it); row 1: A and B; row 2: B (A's last use); row 3: none; row 4: none.
    expect(held).toEqual([1, 2, 1, 0, 0]);
  });

  it('a render that fails fails its row, and the rows before it had their twins', async () => {
    const calls: string[] = [];
    const render = async (job: Job) => {
      calls.push(String(job.shot.name));
      if (job.shot.face === 'light') throw new Error(`row ${job.shot.name}: no twin`);
      return { drawnFor: job.shot.name };
    };
    const share = shareTwins([{ kind: 'field', shot: FIELD }, { kind: 'field', shot: { ...FIELD, name: 'L', face: 'light' } }], render);
    await expect(share.twinAt(0)).resolves.toEqual({ drawnFor: 'dark-one-joy-full.1' });
    await expect(share.twinAt(1)).rejects.toThrow('row L: no twin');
  });

  it('with no look-ahead, a twin is rendered when its first row is asked for, not before', async () => {
    const f = fakeRenderer();
    const B = { ...FIELD, name: 'B.1', face: 'light' };
    const share = shareTwins([{ kind: 'field', shot: FIELD }, { kind: 'field', shot: B }], f.render);
    expect(f.calls).toEqual([]);
    await share.twinAt(0);
    expect(f.calls).toEqual(['dark-one-joy-full.1']);
    await share.twinAt(1);
    expect(f.calls).toEqual(['dark-one-joy-full.1', 'B.1']);
  });

  it('looking ahead n: the next n distinct twins are rendering before their rows are reached, never more, each once', async () => {
    const started: string[] = [];
    const finish = new Map<string, () => void>();
    const render = (job: Job) => {
      started.push(String(job.shot.name));
      return new Promise<string>((resolve) => finish.set(String(job.shot.name), () => resolve(String(job.shot.name))));
    };
    const named = (n: string): Shot => ({ ...FIELD, name: `${n}.1`, tMs: n.charCodeAt(0) });
    const [A, B, C, D, E] = ['A', 'B', 'C', 'D', 'E'].map(named);
    const jobs: Job[] = [A, repeatOf(A, 2), B, C, D, E].map((shot) => ({ kind: 'field' as const, shot }));
    const share = shareTwins(jobs, render, { ahead: 2 });
    // Before any row: the first two distinct twins.
    expect(started).toEqual(['A.1', 'B.1']);
    const row0 = share.twinAt(0);
    expect(started).toEqual(['A.1', 'B.1', 'C.1']); // A reached: two ahead of it
    finish.get('A.1')!();
    await expect(row0).resolves.toBe('A.1');
    await expect(share.twinAt(1)).resolves.toBe('A.1');
    expect(started).toEqual(['A.1', 'B.1', 'C.1']); // A's repeat reaches no new twin
    const row2 = share.twinAt(2);
    expect(started).toEqual(['A.1', 'B.1', 'C.1', 'D.1']);
    finish.get('B.1')!();
    await expect(row2).resolves.toBe('B.1');
    const row3 = share.twinAt(3);
    expect(started).toEqual(['A.1', 'B.1', 'C.1', 'D.1', 'E.1']);
    finish.get('C.1')!();
    await row3;
    for (const n of ['D.1', 'E.1']) finish.get(n)!();
    await expect(share.twinAt(4)).resolves.toBe('D.1');
    await expect(share.twinAt(5)).resolves.toBe('E.1');
    expect(started).toEqual(['A.1', 'B.1', 'C.1', 'D.1', 'E.1']);
    expect(share.held()).toBe(0);
  });

  it('a twin rendered ahead that fails is no unhandled rejection: it fails its own row, when that row is reached', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (e: unknown) => unhandled.push(e);
    process.on('unhandledRejection', onUnhandled);
    try {
      const render = async (job: Job) => {
        if (job.shot.face === 'light') throw new Error(`row ${job.shot.name}: no twin`);
        return job.shot.name;
      };
      const share = shareTwins([{ kind: 'field', shot: FIELD }, { kind: 'field', shot: { ...FIELD, name: 'L.1', face: 'light' } }], render, { ahead: 2 });
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));
      expect(unhandled).toEqual([]);
      await expect(share.twinAt(0)).resolves.toBe('dark-one-joy-full.1');
      await expect(share.twinAt(1)).rejects.toThrow('row L.1: no twin');
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('rows are taken in order: asking for a row out of order is refused', async () => {
    const f = fakeRenderer();
    const share = shareTwins([{ kind: 'field', shot: FIELD }, { kind: 'field', shot: repeatOf(FIELD, 2) }], f.render);
    await expect(share.twinAt(1)).rejects.toThrow(/in order/);
  });
});
