import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import type { FieldViewProps } from '../../../field/FieldView.tsx';
import { mountedLive, type Tap } from '../../../field/placementLedger.ts';
import type { MotionTier } from '../../../motion/useMotionPolicy.ts';
import { BASE, type DirectionId } from '../../../tokens/tokens.generated.ts';
import { useCtaMachine } from '../CommitCTA.tsx';
import { ctaColours, ctaInitial, ctaState, type CtaPaint } from '../ctaState.ts';

// useCtaMachine (DEC-174; the architect's F10 G8 rulings, Q1 and F8): the page's machine, stamped on the JS clock.
//   · start takes FieldView's onStart shape, (admitted, live), so a page binds onStart={cta.start} with nothing between;
//   · it starts from what a FieldView mounted with the same taps shows (mountedLive): shown and settled, tinted by the
//     latest, under the ids the field's fresh ledger gives them;
//   · a new direction or face is a remount of FieldView (its key), with a fresh ledger, so the machine starts again from
//     mountedLive of the taps at that moment; the same paint in a new object, or new taps alone, change nothing.
// Only abyss ships, so a direction switch goes to a second id: the hook compares ids and reads no direction's tokens
// when it starts again, so that switch is read on the machine itself.

jest.useFakeTimers();
afterAll(() => jest.useRealTimers());

const DARK: CtaPaint = { id: 'abyss', face: 'dark' };
const LIGHT: CtaPaint = { id: 'abyss', face: 'light' };
const OTHER: CtaPaint = { id: 'other' as DirectionId, face: 'dark' };
const J: Tap = { x: 0.6, y: 0.6 };
const R: Tap = { x: -0.6, y: -0.6 };
const C: Tap = { x: 0.6, y: -0.6 };
const SETTLE = BASE.motion.settle.duration;
const now = () => performance.now();

type Cta = ReturnType<typeof useCtaMachine>;
function Probe({ paint, tier, taps, out }: { paint: CtaPaint; tier: MotionTier; taps: readonly Tap[]; out: { current: Cta | null } }) {
  out.current = useCtaMachine(paint, tier, taps);
  return null;
}
const mounts: ReactTestRenderer.ReactTestRenderer[] = [];
afterEach(() => {
  for (const m of mounts.splice(0)) act(() => m.unmount());
});
function probe(paint: CtaPaint, taps: readonly Tap[], tier: MotionTier = 'full') {
  const out: { current: Cta | null } = { current: null };
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(<Probe paint={paint} tier={tier} taps={taps} out={out} />);
  });
  mounts.push(r);
  const update = (p: CtaPaint, t: readonly Tap[]) => act(() => r.update(<Probe paint={p} tier={tier} taps={t} out={out} />));
  return { cta: () => out.current!, update };
}

describe('useCtaMachine: FieldView’s start, bound directly', () => {
  it('start takes onStart’s shape, (admitted, live): a start through it shows the CTA on its ramp, tinted by the latest', () => {
    const { cta } = probe(DARK, []);
    const onStart: NonNullable<FieldViewProps['onStart']> = cta().start;
    act(() => cta().store(2));
    act(() => onStart(1, mountedLive([J, R])));
    const t0 = now();
    expect(ctaState(cta().machine, t0, DARK)).toMatchObject({ phase: 'showing', pressable: true });
    expect(ctaState(cta().machine, t0, DARK).tint).toMatchObject({ fill: ctaColours(DARK, 'R').fillHex, owner: 1 });
    expect(ctaState(cta().machine, t0 + SETTLE, DARK)).toMatchObject({ opacity: 1, phase: 'shown' });
  });

  it('start keeps its identity across renders, so binding it never re-makes the field’s listener', () => {
    const { cta, update } = probe(DARK, [J]);
    const first = cta().start;
    update(DARK, [J, R]);
    update(LIGHT, [J, R]);
    expect(cta().start).toBe(first);
  });
});

describe('useCtaMachine: it starts from what the field shows at a mount (mountedLive)', () => {
  it('taps at the mount: shown and settled at once, tinted by the latest, under the ids the field’s fresh ledger gives them', () => {
    const { cta } = probe(DARK, [J, R]);
    expect(cta().machine).toEqual(ctaInitial(DARK, mountedLive([J, R]), 2, now()));
    expect(ctaState(cta().machine, now(), DARK)).toMatchObject({ opacity: 1, phase: 'shown', pressable: true, animating: false });
    expect(ctaState(cta().machine, now(), DARK).tint).toMatchObject({ fill: ctaColours(DARK, 'R').fillHex, owner: 1 });
  });

  it('no taps at the mount: hidden, and not pressable', () => {
    const { cta } = probe(DARK, []);
    expect(ctaState(cta().machine, now(), DARK)).toMatchObject({ opacity: 0, phase: 'hidden', tint: null, pressable: false });
  });
});

describe('useCtaMachine: a new direction or face starts it again (F8)', () => {
  it('a face switch starts it again from mountedLive of the taps at that moment, whatever it was doing', () => {
    const { cta, update } = probe(DARK, [J]);
    act(() => cta().store(0));
    expect(ctaState(cta().machine, now(), DARK).phase).toBe('hiding');
    update(LIGHT, [J, R]);
    expect(cta().machine).toEqual(ctaInitial(LIGHT, mountedLive([J, R]), 2, now()));
    expect(ctaState(cta().machine, now(), LIGHT)).toMatchObject({ opacity: 1, phase: 'shown' });
    update(DARK, []);
    expect(cta().machine).toEqual(ctaInitial(DARK, [], 0, now()));
  });

  it('a direction switch starts it again the same way', () => {
    const { cta, update } = probe(DARK, [J, R]);
    update(OTHER, [C]);
    expect(cta().machine).toEqual(ctaInitial(OTHER, mountedLive([C]), 1, now()));
    expect(cta().machine.tint).toMatchObject({ node: 'C', owner: 0, paint: OTHER });
  });

  it('the same paint in a new object, or new taps alone, change nothing: the machine carries on', () => {
    const { cta, update } = probe(DARK, [J]);
    act(() => cta().store(2));
    act(() => cta().start(1, mountedLive([J, R])));
    const before = cta().machine;
    update({ ...DARK }, [J, R]);
    update({ id: 'abyss', face: 'dark' }, [J]);
    expect(cta().machine).toBe(before);
  });

  it('after a switch, the starts it hears are read in the new paint', () => {
    const { cta, update } = probe(DARK, [J]);
    update(LIGHT, [J]);
    act(() => cta().store(2));
    act(() => cta().start(1, mountedLive([J, R])));
    const t0 = now();
    expect(ctaState(cta().machine, t0 + SETTLE, LIGHT).tint).toMatchObject({ fill: ctaColours(LIGHT, 'R').fillHex, owner: 1 });
    expect(cta().machine.tint!.paint).toEqual(LIGHT);
  });
});
