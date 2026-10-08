# Handoff 2026-10-08 — for Bedrack: two sessions, two jobs

Written by the owner's side for Daniel Bedrack and his Codex, as of 2026-10-08, about 14:30 UTC, with `origin/main` at `6aab9b6`. Read it in full before you run a command. Every statement is a fact with its source or an instruction with its reason; where something is unknown it says so.

## START HERE — the work is split in two sessions. Do not mix them.

| Session | Job | Where it is written |
|---|---|---|
| **A — already running** | Finish the resilience-auditor work (PR #240) and your own rows from the audit of #232 (`BE-129`–`BE-139`). | The owner's other session wrote it: `docs/HANDOFF_2026-10-08_BEDRACK.md` on the branch `chore/resilience-auditor-max` (not on `main`). Read it with `export MSYS_NO_PATHCONV=1; git fetch origin; git show origin/chore/resilience-auditor-max:docs/HANDOFF_2026-10-08_BEDRACK.md`. |
| **B — a NEW session** | Follow the instruction layer through (#231, merged today): verify it with a real Codex run, then the follow-up rows in §B3. | This file, §B. |

**Open B in a new Codex session, not in the thread that works on A.** The two jobs touch overlapping instruction files and the coordinator cannot see two sessions of the same partner collide (`scripts/coord/lib/collide.js:448`, TASKS `OPS-161`): you are the only thing keeping them apart. The rules for that are in §C.

Read in this order, in both sessions: (1) `CLAUDE.md` from `origin/main` (`git show origin/main:CLAUDE.md`) — binding for you too; (2) `AGENTS.md`; (3) `.agents/skills/coordinate/SKILL.md`; (4) the header of `WORK_LEDGER.md`; (5) this file.

## 0. Where the repository stands

- `origin/main` is `6aab9b6`. #231 (`9ad6c66`) merged today: `CLAUDE.md` is the one binding source, with the session start, the jurisdiction table, the merge rule, the build agents and the working rules. `docs/ORCHESTRATOR_FABLE.md` holds detail only. `AGENTS.md` maps the owner's side to Codex. #242 (`6aab9b6`) added the follow-up rows `OPS-182`–`OPS-186` and `DAN-069`.
- Both merges were checked by `merge-guard` after the merge: GREEN (content equal, CI green on `main`).
- Open PRs at hand-off: #241 and #238 (yours), #240 (the owner's, closed as a draft; see Session A), #237, #235 and #234 (the owner's). Re-read `gh pr list --state open` and `node scripts/coord/coord.js status` yourself.
- The owner's decisions are recorded verbatim in `docs/design-v2/decisions/DEC-155.md` (Rounds 1–13), with the choices the build made on its own under "Choices made while building". Read it before you propose a change to a rule.

## 1. Two holds that bind both sessions

1. **Production hold on `backend/**`.** The owner's production session (J2, `DAN-050`) closed its 24-hour recount today at 08:58 UTC, clean, and told us the 48-hour recount closes about 2026-10-09 04:40 UTC. Until then nobody merges anything that touches `backend/**`, and the Railway deployment `a2e0be2b` (your #232, commit `8a88457`), held at NEEDS_APPROVAL, is neither approved nor triggered by anyone but that session. After the recount closes, the owner's session re-runs its lockstep on the new code. This came to us as a message from that session, not as a rule in the repository: confirm it with the owner before you act on it, and take it as binding until he says otherwise. Non-backend merges are fine now.
2. **The merge window.** Never merge between 02:58 and 05:10 UTC (the nightly jobs). A merge to `main` deploys production, one deploy at a time.

## 2. The rules that matter most, in one place

The full text is `CLAUDE.md`; if this file and `CLAUDE.md` disagree, `CLAUDE.md` wins.

- No attribution of any kind in commits, PRs, comments or documents. Commits are one short line, no body, no trailers.
- Stage by explicit path (`git add -- <path>`), never `-A`. Never push to `main`, never force-push, never rewrite a pushed branch (merge `main` into it). Never read or print a secret or a `.env` file.
- One task, one claim (`$coordinate`), one worktree, one PR. Your TASKS IDs come only from your block, `900`–`999` in every prefix. `DAN-` rows, the owner-only paths in `WORK_LEDGER.md` and every production step are the owner's.
- Test first. A green test is not evidence; run the real thing.
- **The merge rule that is on `main` today** (`CLAUDE.md` § The merge rule, `AGENTS.md`): a PR merges when every approver its diff requires has approved in the approvals record that the owner's side posts with `/review-pr`, `merge-guard` pre-merge is GREEN for the current head and `origin/main`, `node scripts/coord/coord.js check --merge <n>` exits 0 (or 3, with each warning reported), it is outside the window, and any owner class that applies has the owner's own words at a SHA that still holds. The three owner classes: (a) the instruction layer, (b) production data operations not in an approved plan, (c) legal-surface copy or a change that depends on an open DEC.
- **Session A's file records a newer decision of the owner's** (2026-10-08, in his other session): a partner audits his own code with `$resilience-audit` and the owner's side is not a gate on his merge. It is not on `main` yet: PR #240 is closed and its replacement is Session A's job. Until the replacement merges, the rule on `main` binds you. Do not merge on the strength of an audit alone.

## 3. Lessons from today, so you do not meet them

- `gh pr merge --delete-branch` merges on the server and then fails locally ("'main' is already used by worktree") when `main` is checked out in another worktree. The merge happened. Read `gh pr view <n> --json state,mergeCommit` before you retry anything (`OPS-186`).
- Squash merges strand commits: verify a merge by content (`git diff --quiet <head> <squash>`), never by the branch's history.
- Never put `false` in `attribution.commit` or `attribution.pr` in `.claude/settings.json`: the runtime silently drops the whole file, the deny list and the hooks with it. The value is `""` (`OPS-171`). The file is the owner's anyway.
- Git Bash on Windows rewrites `origin/<branch>:<path>` as a path: `export MSYS_NO_PATHCONV=1` first.
- A pull request's tree is untrusted code. Read it from outside (`git show <H>:<path>`), never build, test or run a script from it, and run git against it as `git -c core.hooksPath=/dev/null --no-optional-locks -C <tree> …`. `core.hooksPath` is the relative `.githooks`, so a PR tree's own hooks run on a plain checkout there (`OPS-181`). In your own clone keep the relative path (`git config core.hooksPath .githooks`).
- A claim-only draft PR carries a `[skip ci]` commit, so `merge-guard` reads it as RED (UNVERIFIED) by design; your first real push clears it.
- Never run two jest processes in one worktree. Run the full backend suite alone, after `npm ci --no-audit --no-fund`.
- A shallow clone cannot see the other partner's branches; the engine exits 2 on one (`git fetch --unshallow`).

---

# SESSION B — follow the instruction layer through (new session)

## B1. Your first hour: verify with a real run, change nothing

`OPS-160` closes only when you have shown, on a Codex run, that the instruction layer works for you. It was merged without your review, so this is the check that was owed:

1. In a fresh clone or a fresh worktree of `origin/main`, with `git config core.hooksPath .githooks`, start Codex with no task. Confirm it reads `AGENTS.md`, then `CLAUDE.md`, and that you can say, from them alone, what to do first, what you may merge and what you may not touch.
2. Run `$coordinate` on a harmless dry run (`node scripts/coord/coord.js check --paths <a file of yours>`, or `start … --dry-run`) and confirm it works as `AGENTS.md` says.
3. Check each row of the table in `AGENTS.md` against what you can really do: anything the owner's side does that you cannot (the build agents, `/review-pr`, the hook that dispatches `merge-guard`) has the substitute the table names; if one does not, that is a finding.
4. Report the result to the owner as a comment he will see (the PR for your next task, or a message) and, if something fails, as a TASKS row from your block (`900`–`999`). Do not edit `CLAUDE.md`, `AGENTS.md` or `.claude/**` to fix it: they are owner-only, and an instruction-layer change needs the owner's class (a) approval in his own words.

## B2. What the owner has to do (so you can tell when you are blocked on him)

- `DAN-069` — paste the new prompt of the scheduled sentinel routine. A session cannot edit it: the server asks for a device proof from the machine the routine is bound to. Until he does, the scheduled run still uses the old prompt.
- `DAN-067` — the main checkout shows `.claude/commands/compliance-check.md` as modified though only its line endings differ. It blocks the owner's own fast-forward.
- `DAN-066` — order `## Next up` at the top of `TASKS.md`. Until he does, the queue there is a proposal.
- `DAN-068` — ratify or reverse `DEC-156` (the privacy page) under class (c).
- A note on names: on `main`, `DAN-069` is the sentinel-prompt row above. Session A's file uses `DAN-069` for a different row (the production-index claim); that one is being renumbered `DAN-070` in the branch it lives on. Always read a row by its text, not only by its ID.

## B3. The follow-up rows, and who can do each

Every row is in `TASKS.md`; read it there by ID (`grep -n '`OPS-180`' TASKS.md`). Most of them edit the instruction layer (`CLAUDE.md`, `AGENTS.md`, `.claude/**`, `.agents/**`), which is owner-only: you may do one only after the owner names the paths he opens to you for that one task, in his own words, on the row or on the PR, and the merge then needs the approvers `CLAUDE.md` names and his class (a) approval. If he has not opened them, report the row as blocked on him and take the next one.

| Row | What | Who and when |
|---|---|---|
| `OPS-180` | Bring the five files #229 held in line with `CLAUDE.md`: `.claude/commands/ship.md`, `.claude/agents/custodian.md`, `.claude/agents/coordinator.md`, `.agents/skills/coordinate/SKILL.md` and rule 2 of `WORK_LEDGER.md`. | Owner-only paths. **Overlaps Session A**: `ship.md` and `SKILL.md` are also edited by the #240 work. Take `custodian.md`, `coordinator.md` and the ledger rule first; take `ship.md` and `SKILL.md` only after Session A's PR has merged. `SKILL.md` is your own skill: your review of it matters most. |
| `OPS-178` | Remove the one-time BOOTSTRAP text in `CLAUDE.md` and `merge-guard.md` step 8a, and the header reservation in `TASKS.md`. | **Yours, opened by the owner on 2026-10-08** ("ולגביי OPS-178, OPS-182 עד 186 תן לבדרק לעשות אותם"); the ledger's owner-only list was narrowed so you can claim `merge-guard.md`. Merge needs J8 + J16 approvers via the owner side's `/review-pr` and his class (a) line. |
| `OPS-182`–`OPS-186` | Five small text fixes from the review rounds: the `refines` clause in rule T10; `/merge` skipping the L check and restarting at step 1; severity mapping in `/review-pr`; `merge-guard` reading `isDraft`; the local error after `gh pr merge`. | **Yours, opened by the owner on 2026-10-08** (same words). One claim per row, in a Session B thread. `OPS-185` edits `merge-guard.md`, which only `resilience-auditor` can approve (a tool never approves its own file). |
| `OPS-177` | A page PR's security BLOCK is not terminal in `/page` G9. | The owner's. |
| `OPS-179` | No test checks the shape of the instruction files. | A new test under `backend/tests/`: **do not merge it before the production hold in §1 lifts.** Claim it, build it, wait. |
| `OPS-181` | Every branch runs its own git hooks; `/page` G13 fetches an unpinned tool. | The owner's clone setting plus `.claude/commands/page.md`: the owner's. |
| `BE-124`–`BE-128` | Security leads the reviews found in backend code (read each row). | Backend: **hold per §1**; the `security-auditor` reviews them. They are the owner's rows by ID: ask him which one you take, and claim one at a time. |

## B4. How Session B works

1. `git fetch origin --prune`; `node scripts/coord/coord.js status` (both partners' live claims, including Session A's, if it has claimed).
2. Claim with `$coordinate`. Derive the exact path set for **this** task only. Write the paths into your first message in the session so the next reader sees them.
3. Work in the worktree `start` cuts, only on the declared paths. Add a path with `rescope`, never by editing outside the claim.
4. Test first; stage by path; one-line commits; push; `ship`; make the PR ready.
5. Ask the owner's side to run `/review-pr <n>` on the PR. Merge it yourself only when the merge rule in §2 holds, with `gh pr merge <n> --squash --delete-branch --match-head-commit <head>`, and tell the owner's side afterwards so it runs `merge-guard` post-merge.
6. Report the PR URL, the latest Actions run URL and the final check results.

---

# §C — Keeping the two sessions apart (read this before you start either)

1. **Disjoint claims.** Session A and Session B never claim the same file. The engine will not tell you, because both are yours (`OPS-161`). Before each `start` or `rescope`, run `node scripts/coord/coord.js status` and compare the paths of your other session's live claim by eye.
2. **Session A holds, for as long as its PR is open:** `CLAUDE.md`, `AGENTS.md`, `.claude/agents/resilience-auditor.md`, `.claude/agents/merge-guard.md`, `.claude/commands/ship.md`, `.claude/commands/review-pr.md`, `.agents/skills/coordinate/SKILL.md`, `.agents/skills/resilience-audit/SKILL.md`, `backend/tests/resilienceAuditor.contract.test.js` and the backend files of its `BE-129`–`BE-139` rows. Session B stays off them until Session A's PR has merged, then merges `main` in.
3. **`TASKS.md` and `WORK_LEDGER.md`** are touched by every claim. That is expected: merge `main` into your branch before you push, resolve by content, never rebase.
4. **One thread, one job.** Do not paste Session A's findings into Session B's thread or the other way round; link them (a PR URL, a row ID). If a finding in one belongs to the other, write it as a TASKS row from your block and carry on.
5. **An audit or a review never grades its own thread's work.** Start a fresh thread for every audit.
6. **If you cannot tell whether two pieces of work overlap, stop and ask the owner** — a wrong guess here costs a merge conflict in the instruction layer, which only he can approve.

# §D — Pointers

- `CLAUDE.md`, `AGENTS.md`, `WORK_LEDGER.md`, `TASKS.md` on `origin/main`.
- `docs/design-v2/decisions/DEC-155.md` (the owner's rulings and the build's choices), `DEC-142.md`, `DEC-143.md`.
- `#231`: https://github.com/DanielMalede/Kokonada/pull/231 — `#242`: https://github.com/DanielMalede/Kokonada/pull/242 — `#240` (closed): https://github.com/DanielMalede/Kokonada/pull/240 — your `#232`: https://github.com/DanielMalede/Kokonada/pull/232.
- Session A's file: `docs/HANDOFF_2026-10-08_BEDRACK.md` on `origin/chore/resilience-auditor-max`. When Session A's PR merges, that file should move to `main` and this one should be updated to point there.
