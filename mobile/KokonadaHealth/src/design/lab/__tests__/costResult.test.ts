import { RESULT_KEYS, formatCostResult, type CostResult } from '../cost/costResult';
import { LAB_TAG, MAX_LINE_BYTES, formatLine } from '../protocol';

// B8-3, the RESULT line (the architect's B8 plan, "Contracts fixed now"):
//   KOKONADA_LAB RESULT {"run","seq","kind":"cost","scene","frames","displayHz","stepUs":{p50,p95,max},"renderUs":{…},
//                        "gpuProxyUs":{…},"clock":"performance.now"}
// with no tap coordinates, under 4000 bytes, every number finite (RESULT finite and at most 4000 bytes). The numbers are
// informational: DEC-082 (the cost budget) is open, so nothing here judges them against any threshold.

const q = (p50: number, p95: number, max: number) => ({ p50, p95, max });
const RESULT: CostResult = {
  run: 'r1', seq: 0, kind: 'cost', scene: 'cost.abyss.dark.three.full', frames: 1200, displayHz: 120,
  stepUs: q(310, 420, 1900), renderUs: q(800, 1100, 4100), gpuProxyUs: q(1500, 1700, 2600), clock: 'performance.now',
};
const payloadOf = (line: string) => JSON.parse(line.slice(`${LAB_TAG} RESULT `.length));
const bytes = (s: string) => Buffer.byteLength(s, 'utf8');

describe('RESULT is a protocol line kind', () => {
  it('formatLine writes it as KOKONADA_LAB RESULT <json>, with the same refusals as every line', () => {
    expect(formatLine('RESULT', { a: 1 })).toBe(`${LAB_TAG} RESULT {"a":1}`);
    expect(() => formatLine('RESULT', { a: NaN })).toThrow(/not a finite number/);
  });
});

describe('formatCostResult', () => {
  it('writes the contract\'s keys, in the contract\'s order, and nothing else', () => {
    const line = formatCostResult(RESULT);
    expect(line.startsWith(`${LAB_TAG} RESULT {`)).toBe(true);
    expect(Object.keys(payloadOf(line))).toEqual(RESULT_KEYS);
    expect(RESULT_KEYS).toEqual(['run', 'seq', 'kind', 'scene', 'frames', 'displayHz', 'stepUs', 'renderUs', 'gpuProxyUs', 'clock']);
    expect(payloadOf(line)).toEqual(RESULT);
    for (const k of ['stepUs', 'renderUs', 'gpuProxyUs'] as const) expect(Object.keys(payloadOf(line)[k])).toEqual(['p50', 'p95', 'max']);
  });

  it('is well under the limit for a real run id (64 characters, the parser\'s most)', () => {
    expect(bytes(formatCostResult({ ...RESULT, run: 'x'.repeat(64) }))).toBeLessThan(MAX_LINE_BYTES);
  });

  it('a line of exactly 4000 bytes is written; one byte more is refused', () => {
    const base = bytes(formatCostResult({ ...RESULT, run: '' }));
    const at = formatCostResult({ ...RESULT, run: 'r'.repeat(MAX_LINE_BYTES - base) });
    expect(bytes(at)).toBe(MAX_LINE_BYTES);
    expect(() => formatCostResult({ ...RESULT, run: 'r'.repeat(MAX_LINE_BYTES - base + 1) })).toThrow(/over the 4000 bytes/);
  });

  it.each([
    ['displayHz NaN', { displayHz: NaN }],
    ['displayHz Infinity', { displayHz: Infinity }],
    ['a quantile NaN', { stepUs: q(NaN, 1, 2) }],
    ['a quantile Infinity', { renderUs: q(1, 2, Infinity) }],
  ])('a number that is not finite is refused (%s)', (_name, change) => {
    expect(() => formatCostResult({ ...RESULT, ...change } as CostResult)).toThrow(/finite/);
  });

  it.each([
    ['a tap coordinate', { tapX: 0.5 }],
    ['the taps', { taps: [{ x: 0.5, y: 0.5 }] }],
    ['an emotion value', { valence: 0.2 }],
  ])('a key the contract does not name is refused (%s): no tap coordinates or emotion values on a lab line', (_name, extra) => {
    expect(() => formatCostResult({ ...RESULT, ...extra } as CostResult)).toThrow(/not a RESULT key/);
  });

  it('a key inside a quantile triple that is not p50, p95 or max is refused', () => {
    expect(() => formatCostResult({ ...RESULT, stepUs: { ...q(1, 2, 3), x: 4 } } as CostResult)).toThrow(/stepUs/);
  });

  it.each(RESULT_KEYS)('a RESULT without %s is refused', (key) => {
    const partial: Record<string, unknown> = { ...RESULT };
    delete partial[key];
    expect(() => formatCostResult(partial as CostResult)).toThrow(new RegExp(key));
  });

  it.each([
    ['kind other than cost', { kind: 'storm' }],
    ['clock other than performance.now', { clock: 'Date.now' }],
    ['a scene outside the cost group', { scene: 'field.abyss.dark.three.full' }],
    ['frames 0', { frames: 0 }],
    ['frames not whole', { frames: 1.5 }],
    ['seq negative', { seq: -1 }],
    ['displayHz 0', { displayHz: 0 }],
    ['p50 above p95', { stepUs: q(5, 4, 9) }],
    ['p95 above max', { gpuProxyUs: q(1, 9, 8) }],
    ['a negative quantile', { renderUs: q(-1, 2, 3) }],
    ['a fractional quantile (whole microseconds only)', { renderUs: q(1.5, 2, 3) }],
  ])('%s is refused', (_name, change) => {
    expect(() => formatCostResult({ ...RESULT, ...change } as CostResult)).toThrow();
  });
});
