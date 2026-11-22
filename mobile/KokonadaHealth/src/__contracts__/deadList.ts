// QA-116's dead list (Stage 0 Q1b): the production functions a test pins that no production file calls,
// each held here only while the TASKS.md row it cites is open. Data only: this file imports nothing.
// The list only shrinks: an entry whose export gains a production caller, or that no test pins any more,
// fails src/__contracts__/__tests__/pinnedCallers.test.ts until it is removed. A new uncalled pin is not
// added here without its own TASKS row. `file` is relative to mobile/KokonadaHealth; `name` is the
// declared name.

export const DEAD_LIST: readonly { readonly file: string; readonly name: string; readonly row: string }[] = [
  { file: 'src/auth/auth.ts', name: 'isLoggedIn', row: 'OPS-429' },
  { file: 'src/auth/auth.ts', name: 'signOut', row: 'MB-018' },
  { file: 'src/design/accentInk.ts', name: 'accentInkFor', row: 'OPS-430' },
  { file: 'src/design/contrast.ts', name: 'flatten', row: 'OPS-431' },
  { file: 'src/design/contrast.ts', name: 'passesAA', row: 'OPS-431' },
  { file: 'src/design/v2/clock/fieldClock.ts', name: 'advanceFieldTime', row: 'OPS-437' },
  { file: 'src/design/v2/clock/fieldClock.ts', name: 'useRealtimeFieldClock', row: 'OPS-437' },
  { file: 'src/experience/aura/auraUniforms.ts', name: 'advancePulsePhase', row: 'OPS-024' },
  { file: 'src/experience/aurora/auroraField.ts', name: 'focalGlowScale', row: 'OPS-432' },
  { file: 'src/health/blePermissions.ts', name: 'requestBlePermissions', row: 'MB-053' },
  { file: 'src/health/healthConnect.ts', name: 'hasHistoryAccess', row: 'OPS-433' },
  { file: 'src/health/mapToBackend.ts', name: 'summarizeSleep', row: 'OPS-434' },
  { file: 'src/state/hot/laneCommit.ts', name: 'smoothTowards', row: 'OPS-435' },
];
