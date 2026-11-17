// The interim QA-041 floor's baseline (D8 rule 6), measured once on a clean origin/main and never
// raised by the check (no ratchet). src/__contracts__/__tests__/testFloor.test.ts compares jest's own
// list of the files it runs, and the skip/todo markers in them, against it. A TypeScript module, not
// JSON: the design-system lint rejects any file type under src/ that ESLint does not visit.
//
// This file is data: it imports nothing (D8 rule 5 counts src/__contracts__ as production).

export const TEST_FLOOR = {
  sha: '988bab3e44f214fd24ce11f6663431c6ffe2afa7',
  listTestsCount: 219,
  skipCount: 2,
  measuredAt: '2026-11-17T18:28:22Z',
  command: 'cd mobile/KokonadaHealth && node node_modules/jest/bin/jest.js --listTests --json (every project), then measureFloor() of src/testing/guards/testFloor.ts at d1c6cef over those files, on a clean worktree of origin/main',
} as const;
