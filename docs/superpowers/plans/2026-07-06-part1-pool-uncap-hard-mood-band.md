# Part 1 — Pool Uncap + Hard Mood Band Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kill the "same playlist every time" bug by uncapping the candidate pool to the full library and enforcing an un-relaxable, confidence-adaptive biosonic (tempo/energy) band that no relaxation level — including the L4 last resort — can strip away.

**Architecture:** A new pure `biosonicBand.js` computes a logistic tolerance `τ(c)` over `translate()` confidence and filters tracks to the tempo/energy window. `pipeline.js` applies it as a pre-filter *before* the relaxation ladder (which now relaxes only anti-repetition/genre), so mood identity is sacred while repetition relaxes. `candidatePool.js` stops slicing to 500. Variety returns deterministically from the larger pool + the existing exposure engine — **no seeds** (§3.7).

**Tech Stack:** Node/Express, MongoDB (Mongoose), Redis/BullMQ, Jest 29.

## Global Constraints

- Backend tests via Bash: `cd /c/Users/danie/Videos/kokonada-wt-ws1/backend && npx jest <file> 2>&1 | grep -aE "Test Suites:|Tests:|✕"`. Full suite is the regression gate.
- Ship to `main` via the throwaway worktree off `origin/main` (branch `feat/pool-uncap-hard-mood-band`); single-line commit messages, no body/trailers; PR body ends with the Claude Code footer; Daniel approves each merge.
- **Determinism (§3.7): NO variation seeds.** Variety = uncapped pool + exposure decay only.
- **Logistic constants (env-overridable):** `w_min=1.0`, `w_max=3.0`, `c₀=0.6`, `k=10`, `E_tol=0.1`. `τ(c)=w_min+(w_max−w_min)·σ(k·(c₀−c))`, `σ(x)=1/(1+e^{−x})`.
- **Band is un-relaxable.** Only a *literal-zero* band widens (`bandWidened=1`); mood is never traded for novelty. Featureless tracks pass the band (they pay the score's `unknownFeaturePenalty`).
- `SELECTION_POOL_MAX` default → `10000`.

---

### Task 1: `biosonicBand.js` — confidence-adaptive tempo/energy band (pure)

**Files:**
- Create: `backend/app/services/selection/biosonicBand.js`
- Test: `backend/tests/biosonicBand.test.js`

**Interfaces:**
- Produces: `tolerance(confidence) → number`; `withinBand(track, targets) → boolean`; `filterBand(tracks, targets) → Array` (consumed by pipeline.js in Task 3).

- [ ] **Step 1: Write the failing test** — create `backend/tests/biosonicBand.test.js`:

```javascript
'use strict';
process.env.NODE_ENV = 'test';
const { tolerance, withinBand, filterBand } = require('../app/services/selection/biosonicBand');

describe('biosonicBand.tolerance (logistic τ(c))', () => {
  it('saturates tight at full confidence, midpoint 2.0 at c0, wide near zero', () => {
    expect(tolerance(1.0)).toBeCloseTo(1.036, 2);
    expect(tolerance(0.6)).toBeCloseTo(2.0, 5);
    expect(tolerance(0.3)).toBeCloseTo(2.905, 2);
    expect(tolerance(0)).toBeCloseTo(2.995, 2);
  });
  it('is monotonically decreasing in confidence', () => {
    expect(tolerance(0.4)).toBeGreaterThan(tolerance(0.8));
  });
  it('clamps non-finite / out-of-range confidence', () => {
    expect(tolerance(NaN)).toBeCloseTo(tolerance(0), 5);
    expect(tolerance(5)).toBeCloseTo(tolerance(1), 5);
  });
});

describe('biosonicBand.withinBand', () => {
  const targets = { bpmCenter: 120, bpmWidth: 20, energyFloor: 0.3, energyCeiling: 0.8, confidence: 1 };
  it('passes a featureless track (cannot judge — scored with unknown penalty)', () => {
    expect(withinBand({ features: null }, targets)).toBe(true);
  });
  it('keeps an on-band track and drops an off-tempo one at high confidence', () => {
    expect(withinBand({ features: { bpm: 122, energy: 0.5 } }, targets)).toBe(true);
    expect(withinBand({ features: { bpm: 190, energy: 0.5 } }, targets)).toBe(false);
  });
  it('drops an over-energy track and keeps one inside the energy band', () => {
    expect(withinBand({ features: { bpm: 120, energy: 0.95 } }, targets)).toBe(false);
    expect(withinBand({ features: { bpm: 120, energy: 0.6 } }, targets)).toBe(true);
  });
  it('low confidence widens the band so a borderline track is admitted', () => {
    const lowConf = { ...targets, confidence: 0.3 };
    expect(withinBand({ features: { bpm: 165, energy: 0.5 } }, targets)).toBe(false);
    expect(withinBand({ features: { bpm: 165, energy: 0.5 } }, lowConf)).toBe(true);
  });
});

describe('biosonicBand.filterBand', () => {
  it('filters a list to on-band tracks, keeping featureless ones', () => {
    const targets = { bpmCenter: 70, bpmWidth: 15, energyFloor: 0.1, energyCeiling: 0.3, confidence: 1 };
    const tracks = [
      { id: 'slow', features: { bpm: 70, energy: 0.2 } },
      { id: 'fast', features: { bpm: 170, energy: 0.9 } },
      { id: 'nofeat', features: null },
    ];
    expect(filterBand(tracks, targets).map(t => t.id)).toEqual(['slow', 'nofeat']);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `cd /c/Users/danie/Videos/kokonada-wt-ws1/backend && npx jest tests/biosonicBand.test.js 2>&1 | grep -aE "Tests:|✕|Cannot find"` → FAIL (module not found).

- [ ] **Step 3: Implement** — create `backend/app/services/selection/biosonicBand.js`:

```javascript
'use strict';

// Confidence-adaptive biosonic band — the UN-RELAXABLE mood identity. A logistic
// tolerance τ(c) sets the tempo/energy window: tight when translate() is confident,
// smoothly + boundedly wider when it is not (a bare manual tap must not over-constrain
// the whole library). Double-saturating (floor w_min>0: features carry irreducible
// error; ceil w_max: a zero-confidence request still keeps a mood). Pure, no I/O.

const W_MIN = () => parseFloat(process.env.BAND_W_MIN ?? '1.0');
const W_MAX = () => parseFloat(process.env.BAND_W_MAX ?? '3.0');
const C0    = () => parseFloat(process.env.BAND_C0 ?? '0.6');
const K     = () => parseFloat(process.env.BAND_K ?? '10');
const E_TOL = () => parseFloat(process.env.BAND_E_TOL ?? '0.1');

const clamp01 = (x) => Math.min(1, Math.max(0, x));

function tolerance(confidence) {
  const c = Number.isFinite(confidence) ? clamp01(confidence) : 0;
  const sig = 1 / (1 + Math.exp(-K() * (C0() - c)));
  return W_MIN() + (W_MAX() - W_MIN()) * sig;
}

function withinBand(track, targets = {}) {
  const f = track?.features;
  if (!f) return true; // featureless: cannot judge — kept, pays unknownFeaturePenalty in score
  const tau = tolerance(targets.confidence ?? 0);

  const bpm = Number(f.bpm);
  const center = Number(targets.bpmCenter);
  const width = Number(targets.bpmWidth);
  if (Number.isFinite(bpm) && Number.isFinite(center) && Number.isFinite(width)) {
    const half = tau * Math.max(4, width);
    if (bpm < center - half || bpm > center + half) return false;
  }

  const energy = Number(f.energy);
  const floor = Number(targets.energyFloor);
  const ceil = Number(targets.energyCeiling);
  if (Number.isFinite(energy) && Number.isFinite(floor) && Number.isFinite(ceil)) {
    const margin = (tau - W_MIN()) * E_TOL();
    if (energy < floor - margin || energy > ceil + margin) return false;
  }
  return true;
}

function filterBand(tracks = [], targets = {}) {
  return tracks.filter(t => withinBand(t, targets));
}

module.exports = { tolerance, withinBand, filterBand };
```

- [ ] **Step 4: Run it, verify it passes** — `cd /c/Users/danie/Videos/kokonada-wt-ws1/backend && npx jest tests/biosonicBand.test.js 2>&1 | grep -aE "Tests:|✕"` → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/selection/biosonicBand.js backend/tests/biosonicBand.test.js
git commit -m "feat: biosonicBand — logistic confidence-adaptive tempo/energy band (pure)"
```

---

### Task 2: Uncap the candidate pool (500 → 10000)

**Files:**
- Modify: `backend/app/services/selection/candidatePool.js:22`
- Test: `backend/tests/candidatePool.test.js` (create)

- [ ] **Step 1: Write the failing test** — create `backend/tests/candidatePool.test.js`:

```javascript
'use strict';
process.env.NODE_ENV = 'test';
jest.mock('../app/config/redis', () => ({ getRedis: jest.fn(() => null), createConnection: jest.fn() }));
const { buildPool } = require('../app/services/selection/candidatePool');

const lib = (i) => ({ id: `t${i}`, provider: 'spotify', name: `S${i}`, artist: `A${i}`, genres: ['pop'], affinity: i, uri: `spotify:track:t${i}` });

describe('candidatePool.buildPool — uncapped', () => {
  it('returns the whole library when it exceeds the old 500 cap', async () => {
    const library = Array.from({ length: 800 }, (_, i) => lib(i));
    const pool = await buildPool({ userId: 'u1', musicProfile: { library, lastAnalyzed: new Date() }, moodKey: 'uplift' });
    expect(pool.length).toBe(800);
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — `cd /c/Users/danie/Videos/kokonada-wt-ws1/backend && npx jest tests/candidatePool.test.js 2>&1 | grep -aE "Tests:|✕|Received"` → FAIL (`pool.length` is 500, expected 800).

- [ ] **Step 3: Implement** — in `candidatePool.js`, change line 22:

```javascript
const POOL_MAX = () => parseInt(process.env.SELECTION_POOL_MAX || '10000', 10);
```

- [ ] **Step 4: Run it, verify it passes** — `cd /c/Users/danie/Videos/kokonada-wt-ws1/backend && npx jest tests/candidatePool.test.js 2>&1 | grep -aE "Tests:|✕"` → PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/selection/candidatePool.js backend/tests/candidatePool.test.js
git commit -m "feat: uncap candidate pool to full library (SELECTION_POOL_MAX 500->10000)"
```

---

### Task 3: Wire the band into the pipeline + telemetry

**Files:**
- Modify: `backend/app/services/selection/pipeline.js` (import `filterBand`; pre-ladder band → `workingPool`/`bandWidened`; 3-level anti-repetition ladder over `workingPool`; L4 within `workingPool`; telemetry `banded`+`bandWidened`)
- Modify: `backend/app/sockets/biometricHandler.js:506` (extend `[selection.v2]`)
- Modify: `KOKONADA_ARCHITECTURE_MASTER.md` (ladder wording: L0 full → L1 drop genre → L2 drop mood → L4)
- Test: `backend/tests/selectionPipeline.test.js`

**Interfaces:**
- Consumes: `filterBand(pool, targets)` from Task 1.
- Produces: `telemetry.banded` (number), `telemetry.bandWidened` (0|1) on `selectPlaylist`'s return.

- [ ] **Step 1: Write the failing tests** — add to `backend/tests/selectionPipeline.test.js` inside `describe('pipeline.selectPlaylist', …)`:

```javascript
  it('the biosonic band excludes off-mood tracks even when the ladder relaxes to L4', async () => {
    const all = PROFILE.library.map(t => `at:artist${t.id}|song ${t.id}`);
    ledger.hardExcluded.mockResolvedValue(new Set(all)); // saturate → force L4
    featureRepo.getMany.mockResolvedValue(new Map(
      PROFILE.library.map((t, i) => [`spotify:${t.id}`, { bpm: i < 15 ? 70 : 200, energy: i < 15 ? 0.2 : 0.95 }])
    ));
    const calm = await selectPlaylist({ ...BASE, k: 5, targets: { bpmCenter: 70, bpmWidth: 15, energyFloor: 0.1, energyCeiling: 0.3, valenceTarget: 0.5, confidence: 1 } });
    expect(calm.tracks.length).toBeGreaterThan(0);
    expect(calm.tracks.every(t => Number(t.id.slice(1)) < 15)).toBe(true); // only the on-band (bpm~70) tracks
    expect(calm.telemetry.relaxLevel).toBe(4);
    expect(calm.telemetry.banded).toBeLessThan(calm.telemetry.poolSize);
  });

  it('widens the band (bandWidened=1) ONLY when no on-mood track exists — never serves empty', async () => {
    featureRepo.getMany.mockResolvedValue(new Map(
      PROFILE.library.map(t => [`spotify:${t.id}`, { bpm: 200, energy: 0.98 }])
    ));
    const calm = await selectPlaylist({ ...BASE, k: 5, targets: { bpmCenter: 60, bpmWidth: 8, energyFloor: 0.05, energyCeiling: 0.15, valenceTarget: 0.5, confidence: 1 } });
    expect(calm.telemetry.bandWidened).toBe(1);
    expect(calm.tracks.length).toBeGreaterThan(0);
  });
```

- [ ] **Step 2: Run them, verify they fail** — `cd /c/Users/danie/Videos/kokonada-wt-ws1/backend && npx jest tests/selectionPipeline.test.js -t "biosonic band excludes|widens the band" 2>&1 | grep -aE "Tests:|✕"` → FAIL (`telemetry.banded`/`bandWidened` undefined; off-band tracks leak at L4).

- [ ] **Step 3a: Implement — import** in `pipeline.js` after the `select` import (line 8):

```javascript
const { filterBand } = require('./biosonicBand');
```

- [ ] **Step 3b: Implement — band pre-filter.** In `pipeline.js`, immediately after the `const featured = pool.reduce(...)` line (right before `mark('context', t);`), insert:

```javascript
  // Un-relaxable biosonic band — mood identity. The ladder below relaxes ONLY
  // anti-repetition/genre; the band is never relaxed. Featureless tracks pass.
  // Only a LITERAL-zero band widens (never trade mood for novelty).
  const banded = filterBand(pool, targets);
  let bandWidened = 0;
  let workingPool = banded;
  if (banded.length === 0) { workingPool = pool; bandWidened = 1; }
```

- [ ] **Step 3c: Implement — ladder over `workingPool`, energy removed.** Replace the `const LADDER = [...]` block and the `applyHardFilters(pool, {...})` call. New `LADDER` (3 levels — energy/tempo now owned by the band):

```javascript
  const LADDER = [
    { excludeGenres, moodExcluded },                // L0 full
    { excludeGenres: [], moodExcluded },            // L1 drop genre excludes
    { excludeGenres: [], moodExcluded: new Set() }, // L2 drop mood window
  ];
```

and the filter call inside the ladder loop becomes:

```javascript
    filtered = applyHardFilters(workingPool, {
      hardExcluded,
      moodExcluded: LADDER[level].moodExcluded,
      provider: filterProvider,
      excludeGenres: LADDER[level].excludeGenres,
      energyCeiling: null, // energy/tempo owned by the un-relaxable biosonic band
      targetConfidence: targets.confidence ?? 0,
    });
```

- [ ] **Step 3d: Implement — L4 within band.** In the L4 block, change the familiar source from `pool` to `workingPool`:

```javascript
  if (filtered.length === 0 && (musicProfile.library || []).length > 0) {
    const familiar = workingPool.filter(tr => !tr.isDiscovery);
```

(leave the rest of the L4 block unchanged: `applyHardFilters(familiar, { hardExcluded: new Set(), moodExcluded: new Set(), provider: filterProvider, excludeGenres: [], energyCeiling: null, targetConfidence: targets.confidence ?? 0 }); relaxLevel = 4;`).

- [ ] **Step 3e: Implement — telemetry.** In the returned `telemetry` object, add `banded` and `bandWidened`:

```javascript
    telemetry: {
      poolSize: pool.length,
      afterFilters: filtered.length,
      relaxLevel,
      degraded,
      featured,
      banded: banded.length,
      bandWidened,
      stageMs,
    },
```

- [ ] **Step 3f: Implement — the `[selection.v2]` log.** In `biometricHandler.js:506`, replace the `console.warn` with:

```javascript
      console.warn(`[selection.v2] pool=${playlist.telemetry.poolSize} featured=${playlist.telemetry.featured} banded=${playlist.telemetry.banded} filtered=${playlist.telemetry.afterFilters} relax=${playlist.telemetry.relaxLevel} widened=${playlist.telemetry.bandWidened} ms=${playlist.telemetry.stageMs?.total} reqId=${reqId}`);
```

- [ ] **Step 3g: Implement — master-doc ladder wording.** In `KOKONADA_ARCHITECTURE_MASTER.md`, change `L0 full → L1 → L2 drop genre excludes → L3 drop mood window` to `L0 full → L1 drop genre excludes → L2 drop mood window` (the ladder is now 3 levels; L4 unchanged).

- [ ] **Step 4: Run them, verify they pass** — `cd /c/Users/danie/Videos/kokonada-wt-ws1/backend && npx jest tests/selectionPipeline.test.js 2>&1 | grep -aE "Test Suites:|Tests:|✕"` → all PASS (new + existing).

- [ ] **Step 5: Run the handler suite too** — `cd /c/Users/danie/Videos/kokonada-wt-ws1/backend && npx jest tests/selectionPipeline.test.js tests/biometricHandler.pipeline.test.js 2>&1 | grep -aE "Test Suites:|Tests:"` → all PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/selection/pipeline.js backend/app/sockets/biometricHandler.js backend/tests/selectionPipeline.test.js KOKONADA_ARCHITECTURE_MASTER.md
git commit -m "feat: apply un-relaxable biosonic band pre-ladder + banded/bandWidened telemetry"
```

---

### Task 4: Full-suite regression + PR

- [ ] **Step 1: Run the full backend suite** — `cd /c/Users/danie/Videos/kokonada-wt-ws1/backend && npx jest 2>&1 | grep -aE "Test Suites:|Tests:|^FAIL "` → all pass except the known `shadow.flip`/`shadow.selection` wall-clock flakes (green in isolation).

- [ ] **Step 2: Push + open PR to `main`** — `git push -u origin feat/pool-uncap-hard-mood-band`, then `gh pr create --base main` (body ends with the Claude Code footer). Wait for Daniel's merge approval; verify CI + `/health` after.

- [ ] **Step 3: Ops verification (post-deploy):** regenerate two contrasting moods; confirm the `[selection.v2]` log shows `relax` back to 0–2 (not 4) in normal use, `banded` a healthy fraction of `pool`, and the two playlists differ.

## Self-Review

- **Spec coverage:** Part 1 §1.1 (uncap) → Task 2; §1.2 (band + logistic τ) → Task 1 + Task 3b; §1.2 never-empty/bandWidened → Task 3d + Task 3 test 2; §1.3 (telemetry) → Task 3e/3f. ✓
- **Placeholders:** none — every step has concrete code/commands.
- **Type consistency:** `tolerance`/`withinBand`/`filterBand` defined in Task 1, consumed in Task 3b; `telemetry.banded`/`bandWidened` defined in Task 3e, read in Task 3f and asserted in Task 3 tests. ✓
- **Determinism:** no seeds introduced; variety is the uncapped pool + exposure. ✓
