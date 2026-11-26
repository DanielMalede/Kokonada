import { STORM_KEEP, STORM_POINTS, STORM_TAPS_PER_SECOND, stormInput } from '../cost/costStorm';

// B8-3, the fieldCost bench's storm (the architect's B8 plan, B8-3: "the storm script is 7 taps/s and deterministic"; the
// resilience T5 r1 Q5: "during a 7 taps/s storm, which is the ledger's allocation and GC peak"). The cold lane's taps as a
// storm drives them: one new tap every 1000/7 ms from the bench's first recorded frame, cycling the four quadrant points,
// the lane keeping its last three (as the cold lane's store does), with seq the number of changes so far. A pure function
// of the elapsed time, so the same frame times give the same inputs on every run and every device.

const PERIOD = 1000 / 7;

describe('the storm is 7 taps a second', () => {
  it('the rate is 7', () => {
    expect(STORM_TAPS_PER_SECOND).toBe(7);
  });

  it('change k lands at k·1000/7 ms: just before it seq is k − 1, just after it seq is k', () => {
    for (let k = 1; k <= 140; k++) {
      expect(stormInput(k * PERIOD - 0.01).seq).toBe(k - 1);
      expect(stormInput(k * PERIOD + 0.01).seq).toBe(k);
    }
  });

  it('every whole second after the first holds exactly 7 changes (the first 6: its change 0 is the start), over 20 s sampled every 1 ms', () => {
    const perSecond = new Map<number, number>();
    let last = stormInput(0).seq;
    for (let t = 1; t < 20_000; t++) {
      const seq = stormInput(t).seq;
      if (seq !== last) perSecond.set(Math.floor(t / 1000), (perSecond.get(Math.floor(t / 1000)) ?? 0) + (seq - last));
      last = seq;
    }
    expect(perSecond.get(0)).toBe(6);
    for (let s = 1; s < 20; s++) expect(perSecond.get(s)).toBe(7);
  });

  it('at 120 Hz frames for 10 s the ledger sees 70 changes, each a new seq and new taps by value', () => {
    const inputs = Array.from({ length: 1200 }, (_, i) => stormInput((i * 1000) / 120));
    let changes = 0;
    for (let i = 1; i < inputs.length; i++) {
      if (inputs[i].seq === inputs[i - 1].seq) {
        expect(inputs[i].taps).toEqual(inputs[i - 1].taps);
      } else {
        expect(inputs[i].seq).toBe(inputs[i - 1].seq + 1);
        expect(inputs[i].taps).not.toEqual(inputs[i - 1].taps);
        changes += 1;
      }
    }
    expect(changes).toBe(69); // seq 0 at t 0, then changes 1..69 before 10 s (the 70th lands at 10 000 ms)
    expect(inputs[inputs.length - 1].seq).toBe(69);
  });
});

describe('the storm is deterministic', () => {
  it('the same time gives the same input, on any call order', () => {
    const times = [0, 1, 142.8, 143, 1000, 5555.5, 9999];
    const forward = times.map(stormInput);
    const backward = [...times].reverse().map(stormInput).reverse();
    expect(backward).toEqual(forward);
  });

  it('cycles the four quadrant points, keeping the last three, oldest first', () => {
    expect(STORM_POINTS).toHaveLength(4);
    expect(STORM_KEEP).toBe(3);
    expect(stormInput(0)).toEqual({ seq: 0, taps: [STORM_POINTS[0]] });
    expect(stormInput(PERIOD + 1)).toEqual({ seq: 1, taps: [STORM_POINTS[0], STORM_POINTS[1]] });
    expect(stormInput(2 * PERIOD + 1)).toEqual({ seq: 2, taps: [STORM_POINTS[0], STORM_POINTS[1], STORM_POINTS[2]] });
    expect(stormInput(3 * PERIOD + 1)).toEqual({ seq: 3, taps: [STORM_POINTS[1], STORM_POINTS[2], STORM_POINTS[3]] });
    expect(stormInput(4 * PERIOD + 1)).toEqual({ seq: 4, taps: [STORM_POINTS[2], STORM_POINTS[3], STORM_POINTS[0]] });
  });

  it('its points are on the unit disc, one per quadrant', () => {
    const quadrants = STORM_POINTS.map((p) => `${Math.sign(p.x)},${Math.sign(p.y)}`);
    expect(new Set(quadrants).size).toBe(4);
    for (const p of STORM_POINTS) expect(Math.hypot(p.x, p.y)).toBeLessThan(1);
  });

  it('before the first frame there is no storm yet: a negative time is the first input', () => {
    expect(stormInput(-5)).toEqual(stormInput(0));
  });
});
