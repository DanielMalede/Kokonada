---
description: Run one page through the design-v2 pipeline — gates G0–G14 in fixed order, no skips, every verdict recorded with its input SHA.
argument-hint: [page id, P1–P14]
---
Run page $ARGUMENTS through the page pipeline of docs/plans/DESIGN_V2_PLAN.md. ultrathink. You are the orchestrator: you dispatch and record; you never judge a gate and never build.

PRECONDITIONS — stop and tell me if any fails:
- Stage 0 is complete: V1 direction chosen, ADR-0017 accepted, the token pipeline (F1), themes and motion policy (F2/F3), the Design Lab (F4), i18n/RTL (F7), the component library (F10), test infrastructure (Q1–Q3).
- $ARGUMENTS matches a row of the plan's page table.
- The page has its own worktree and branch. Stage by explicit path, never -A. Never rebase or force-push a page branch; merge main into it — a rewritten SHA voids every verdict that names it.

THE RECORD — docs/design-v2/pages/$ARGUMENTS/
- gates.json is the index: per gate, an append-only list of entries {agent, verdict, pass, date, inputSha, inputs, artefact, verdictFile, round}. The latest entry per agent counts; history is never rewritten.
- verdicts/G<k>-<agent>-r<round>.md holds each verdict word for word. developer is the scribe (read-only agents cannot write). Before it commits, diff the file against the agent's returned message; any difference is re-scribed. Commit single-line, e.g. "docs: P1 G4 verdicts".
- inputSha is the page-branch HEAD you state in the dispatch prompt. Every verdict must quote it back; one that does not is re-requested, not recorded.
- inputs: G0–G6 declare their upstream artefacts (the plan row, the L1 registry rows, charter.md, brief.md, spec.md, the board, the token source). G7–G12 declare the PAGE SLICE from the G0 charter, plus spec.md. gates.json and verdicts/ are never inputs.
- A verdict is STALE when `git diff --quiet <inputSha> HEAD -- <inputs>` fails. A stale verdict does not count.
- Owner gates (G2, G3, G6, G13) are recorded only from my own message, verbatim, with the SHA of what I saw. No agent message is ever my approval.
- Tell every gate agent: no tool or vendor names in the verdict — verdicts are tracked files under the attribution guard.

THE GATES — fixed order. A gate opens only when every earlier gate passes and is not stale. N/A is allowed only where marked, and is recorded with its reason like any verdict.
G0 Page charter — architect; designer names the page's ONE job. charter.md: the source (DTO or store) of every displayed field, the OS-permission sequence, consent dependencies, the "cannot be drawn" list, socket events and routes nobody consumes, ADR-0005 and ADR-0013 applied, forks as decision tables, the PAGE SLICE.
G1 Constraint brief, before any pixel — compliance-auditor, regulatory-researcher and resilience-auditor, all three on every page, in parallel; sentinel too when the page touches a provider. brief.md: every must, must-not and open question with its CMP-/REG-/QA- ID and source; locked strings; reserved slots for copy that waits on counsel; the full state matrix. Exit: no HALT open on the page's surfaces. A HALT stops the page.
G2 Forks — me, on a real fork from G0 or G1, as a DEC- entry in docs/design-v2/DECISIONS.md. N/A when there is no real fork; it then merges into G6.
G3 Direction — designer composes at most two options; developer builds them as a live HTML board from the generated tokens. Exit: I pick one.
G4 Spec pack — designer; architect co-signs feasibility, resilience-auditor co-signs state coverage. spec.md: every state in both faces at every font size; the motion, haptics and accessibility tables; the copy list with keys. Exit: three signatures.
G5 Pre-clearance — compliance-auditor (assets, marks, the Garmin notice when Garmin data shows) and regulatory-researcher (copy frozen against the copy rulebook; each market's deceptive-pattern checks). Exit: both pass. A SHIP issued without G5 is void.
G6 Prototype — me, on the live interactive HTML board. New backend data shapes start only after this gate.
G7 Backend contract first — developer, then resilience-auditor: DTO tests, then code. Exit: backend suite green. N/A only when the charter lists no contract change.
G8 New components — developer builds each in the Design Lab; designer gives each a SHIP from its captures. N/A only when the charter lists no new component.
G9 Build — developer, strict TDD, full integration against the real contract; the page lives only in the Design Lab until this PR swaps it into navigation. designer checks once on device about halfway. Run /security-review on P5, P6, P9 and P11, and on any page that adds a deep link, an exported activity, a token in a URL or a file export. Exit: mobile jest, backend npm test, lint:design-system, the focused tsc and the token-freshness check all green, and the page imports nothing from v1.
G10 Resilience — resilience-auditor: the false-green hunt and a diff against the contract registry. Exit: no blocker.
G11 Device evidence — developer: a release Hermes build; Perfetto frame timing; the capture matrix (both faces, font 1.0 and 2.0, reduced motion, battery saver, RTL); TalkBack; thermal; a 50-transition leak loop. Artefact: the evidence pack and its manifest (commit SHA, device, hash per capture).
G12 Final reviews — designer gives the measured SHIP (zero lint violations; every state captured in both faces, at font 1.0 and 2.0, under reduced motion and battery saver; contrast on real pixels at the field's worst moment, 4.5:1 text and 3:1 components; 48 dp targets; the Stage 0 frame budgets; copy matching the keyed list); compliance-auditor checks the built result on device; regulatory-researcher runs only if copy or placement drifted from what G5 cleared.
G13 Merge — me. First confirm from gates.json that G0–G12 each hold a passing, non-stale verdict against the PR head SHA, and list any stale or missing one. Present the PR and stop. After the squash merge, verify on main by content.
G14 Hygiene — custodian, between waves only, with all four of its run preconditions clear: remove this page's v1 leftovers and pin a guard. Exit: the guard is green.

RE-RUN RULES
- A fix re-runs the gate whose finding it fixes, then every later gate it made stale. The staleness rule decides, not judgement. A re-run on unchanged substance is a short re-affirmation at the new SHA, not a fresh review.
- Every finding cites a rule ID and a severity: P0 (contract, ethics, law, contrast), P1 (hierarchy), P2 (polish — never blocking).
- At most two review rounds per gate; after that the question comes to me as a DECISIONS.md entry.
- A systemic finding becomes a token or component change, then a sweep of every page already migrated; the staleness rule shows which of their gates re-open.
- A HALT is terminal until resolved. Never re-run a gate hoping for a different answer without new evidence, and never argue a verdict away.
- Changing the direction after G3 needs a superseding ADR.

REPORT after each gate, in one block: page, gate, verdict per agent, input SHA, artefact path, what is now stale, the next gate. Mark any work that passed through no agent. Stop at every owner gate, every HALT and every Pause & Guide.
