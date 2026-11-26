import { EXTENSIONS } from '../../tokens/tokens.extensions.generated.ts';
import { DIRECTIONS, type DirectionId, type Face } from '../../tokens/tokens.generated.ts';
import { NODE, NODE_SLOTS } from '../fieldLaw.ts';
import { buildFieldFrame, type FieldStatics } from '../fieldFrame.ts';
import { frameState, geometry } from '../ledgerStorms.ts';
import { ADMISSION, emptyLedger, fades, ledgerConfig, reconcile, type LedgerConfig } from '../placementLedger.ts';
import { ledgerConfigFor, staticsFor } from '../statics.ts';

// T12, G-c (architect T5 r1) and F13 (resilience T5 r1): the lobe rule lived twice, the ledger's
// bearsLobe on the caller's config and the builder's anyLobe on DIRECTIONS. ledgerConfigFor is the one
// way FieldView and the tests make the ledger's config, from the direction, the face's rest table in the
// statics and the plate, so the two cannot disagree.

const IDS = Object.keys(DIRECTIONS) as DirectionId[];
const FACES: readonly Face[] = ['dark', 'light'];
const statics = (id: DirectionId): FieldStatics => staticsFor(id, EXTENSIONS as never);
const plate = { radiusPx: geometry.radiusPx, pxPerDp: geometry.pxPerDp };

// One tap on each node, and the neutral centre.
const NODE_TAPS = { J: { x: 0.5, y: 0.5 }, C: { x: 0.5, y: -0.5 }, R: { x: -0.5, y: -0.5 }, I: { x: -0.5, y: 0.5 }, neutral: { x: 0, y: 0 } } as const;

/** The ledger's rule: a fresh mount of one tap turns the rest lobes off when the tap carries a lobe. */
function ledgerSaysLobe(config: LedgerConfig, id: DirectionId, face: Face, tap: { x: number; y: number }): boolean {
  const f = fades(reconcile(emptyLedger(config), { seq: 1, taps: [tap] }, 0, 'settle'));
  expect(f.placements).toHaveLength(1);
  return f.restFades.every((v) => v === 0);
}

/** The builder's rule: given rest fade 0, it draws no rest lobe only when a placement carries a lobe (else it forces 1). */
function builderSaysLobe(id: DirectionId, face: Face, s: FieldStatics, tap: { x: number; y: number }): boolean {
  const state = { ...frameState(id, face, { placements: [{ id: 0, ordinal: 0, driftKey: 0, x: tap.x, y: tap.y, node: 'J', fade: 1, role: 'live', slot: 0 }], ended: [], restFade: 0, restFades: s.restLobes[face].map(() => 0), restSlots: s.restLobes[face].map((_, i) => i + 1), demand: 1 }) };
  const frame = buildFieldFrame(state, geometry, s);
  return frame.nodes.filter((n) => n.id === NODE.R0 && n.bead === null && n.fade > 0).length === 0;
}

describe('ledgerConfigFor (G-c, F13)', () => {
  it('the scan sees every direction and face', () => {
    expect(IDS.length).toBeGreaterThan(0);
  });

  for (const id of IDS) {
    for (const face of FACES) {
      it(`${id} ${face}: counts the face's rest lobes and reads neutralLobe from the direction`, () => {
        const s = statics(id);
        const config = ledgerConfigFor(id, face, s, plate);
        expect(config.restLobes).toBe(s.restLobes[face].length);
        expect(config.overlap.rest).toEqual(s.restLobes[face]);
        expect(config.neutralLobe).toBe(DIRECTIONS[id].field.lobe.neutralLobe > 0);
        expect(config).toEqual(ledgerConfig(id, s.restLobes[face], plate));
      });

      it(`${id} ${face}: every start admits one (3 live + 1 entering + the rest lobes fit NODE_SLOTS)`, () => {
        const s = statics(id);
        expect(3 + 1 + ledgerConfigFor(id, face, s, plate).restLobes).toBeLessThanOrEqual(NODE_SLOTS);
        expect(ADMISSION.nodes).toBe(NODE_SLOTS);
      });

      for (const [node, tap] of Object.entries(NODE_TAPS)) {
        it(`${id} ${face}: the ledger and the builder agree whether one tap on ${node} carries a lobe`, () => {
          const s = statics(id);
          expect(ledgerSaysLobe(ledgerConfigFor(id, face, s, plate), id, face, tap)).toBe(builderSaysLobe(id, face, s, tap));
        });
      }
    }
  }

  it('a config that disagrees with the builder is caught (planted: neutralLobe flipped)', () => {
    const id = IDS[0];
    const s = statics(id);
    const good = ledgerConfigFor(id, 'light', s, plate);
    const planted = { ...good, neutralLobe: !good.neutralLobe };
    expect(ledgerSaysLobe(planted, id, 'light', NODE_TAPS.neutral)).not.toBe(builderSaysLobe(id, 'light', s, NODE_TAPS.neutral));
  });
});
