// The RETIRE entries (DEC-091, refined by DEC-142): each records a v1 test file or a QA-118 pin removed
// on purpose, signed by a DECIDED DEC. `kind: 'file'` names a test file relative to the app (posix),
// which lowers the interim QA-041 floor by one (./test-floor.json); `kind: 'pin'` names a pin id in
// ./pins.ts. An entry for a file jest still runs, or for a pin still in place, is red; so is one whose
// DEC is missing or not DECIDED in docs/design-v2/decisions/.
//
// This file is data: it imports nothing (D8 rule 5 counts src/__contracts__ as production).

export interface RetireEntry {
  kind: 'file' | 'pin';
  target: string;
  dec: string;
  reason: string;
}

export const RETIRE: readonly RetireEntry[] = [];
