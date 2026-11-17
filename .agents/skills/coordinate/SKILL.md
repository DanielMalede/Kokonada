---
name: coordinate
description: Start, ship, merge or drop a Kokonada task without colliding with the other partner. Run it before touching any file in a new task, when a task needs a file it did not declare, before marking a PR ready, before merging, and whenever you need to know who is working on what. It checks the other partner's live work on origin, claims a slot in WORK_LEDGER.md, marks the TASKS.md row as taken and opens a draft PR, all through scripts/coord/coord.js.
---

# Coordinate — two partners, one repository

Two people change this repository at the same time: **Malede** (GitHub `DanielMalede`, the owner) and **Bedrack** (GitHub `DanielBedrack`). Both run the same engine, `node scripts/coord/coord.js`, so a claim made on one side is seen on the other. There is **no branch protection** on this repository, and **a merge to `main` deploys the backend to production**. This protocol is the only thing that keeps one partner from silently overwriting the other.

The full rules, the People table and the list of exclusive files are in `WORK_LEDGER.md` at the repository root. Read its header once per session.

## Before you run anything

- **Network.** The engine fetches from GitHub and calls `gh`. Request network access for these commands. If fetch or `gh` fails, the engine exits 2: report **CANNOT VERIFY** and stop. Never decide on stale refs.
- **Truth is `origin`.** Read files as `git show origin/main:<path>`. Never trust a local `main` checkout.
- **Identity is the GitHub login** (`gh api user --jq .login`), never a first name. Both partners are named Daniel; elsewhere in this repository "Daniel" means Malede, the owner. `COORD_LOGIN` exists only for tests and CI; if it is set and disagrees with `gh`, the engine exits 2.
- **Use a full clone.** A shallow clone cannot see the other partner's branches; the engine exits 2 on one. If it says so, run `git fetch --unshallow`. (A single-branch clone is fine: the engine fetches every branch itself.)
- **Until `WORK_LEDGER.md` is on `main`**, `check` reads the rules from your checkout and can only reach WARN, and `start` refuses with exit 2. The first PR that adds the ledger is claimed by hand.

## Start a task

1. **Find the task.**
   - A TASKS task: search its ID in `git show origin/main:TASKS.md` and read the title, every `where:` path, `done when:` and any `- status:` line. A row already taken on a live branch is a collision.
   - An own task: name it `own:<short-slug>`.
   - `DAN-` rows are the owner's alone. Never claim one.
2. **Derive the exact path set.** Start from the `where:` paths. For each file, add what moves with it: its importers and importees, and every test that names it (search `backend/tests/` and `mobile/KokonadaHealth/**/__tests__/`). Add the tests you will create, and any new folder as a narrow glob with at least two literal segments (`project-explorer/src/**` is fine; `project-explorer/**`, `backend/**`, `docs/**` and `**` are refused as too broad). Declare files, not whole areas.
3. **Add resources** if the task touches something that is not a file: `res:atlas-prod`, `res:railway-vars`, `res:store-android`, `res:store-ios`, `res:secrets`, and `res:prod-deploy` while production must not change (a recount, a migration, an incident): while anyone holds it, `check --merge` refuses every merge to `main`, your own included. These are normally the owner's.
4. **Check:**
   ```
   node scripts/coord/coord.js check --task <ID|own:slug> --paths <p1,p2,...> [--resources <r1,...>]
   ```
   Exit 0 CLEAR · 3 WARN · 1 HALT · 2 CANNOT VERIFY.
5. **On CLEAR (or WARN you have reported), claim:**
   ```
   node scripts/coord/coord.js start --task <ID|own:slug> --title "<one line>" --paths <...> [--resources <...>] --branch <prefix>/<id>-<slug>
   ```
   It creates a worktree from `origin/main` (by default `<main repo root>/.worktree-<branch with "/" replaced by "-">`; a relative `--dir` is also resolved against the main repo root, never the current folder), fills your next free slot in your section of the ledger, writes the TASKS marker, commits by path with `[skip ci]`, pushes, re-checks for a race and opens a **draft PR**. On WARN it prints the warnings, claims anyway and exits 3. If it stops half way, run the same command again: it resumes your own pushed claim, and it never reuses a branch name that exists on `origin` without your claim, or that `main`'s ledger still records.
6. **Work only inside that worktree, and only on the declared paths.**

## On HALT

Stop. Do not touch the files, do not retry with a narrower set to get past it, and do not work "carefully" on a shared file. A branch whose owner the engine cannot map also HALTs on a real overlap: ask which partner owns it, or have Malede add the identity to the People table. Report:
- what the task is and the paths you declared;
- what it meets: the partner, his branch, his slot, the file, and the class (exact, glob, exclusive group, coupled file, resource, task, unclaimed branch);
- the options: wait until his PR merges and claim then; split the work so the files are disjoint; or both partners agree in writing on a shared file.

The earlier claim holds, and the later one stops. In practice `check` and `start` stop whoever runs them on a live claim or an unclaimed branch of the partner, and a race stops both. The humans decide; the engine and you never do.

A HALT *after* the push means you lost a race: your claim is already pushed, no draft PR was opened, and the engine prints how to release it. Releasing is manual (`git push origin --delete <b>`, `git worktree remove <dir>`, `git branch -D <b>`); the script never deletes anything.

## During and after

| When | Run |
|---|---|
| The task needs a file it did not declare | `node scripts/coord/coord.js rescope --paths <full new set>` in the task worktree, **before** touching the file |
| Ready for review | `node scripts/coord/coord.js ship` in the task worktree, then `gh pr edit --body-file <file>` and `gh pr ready` |
| Before merging | `node scripts/coord/coord.js check --merge <PR number>` |
| Dropping the task | `node scripts/coord/coord.js release` prints the close and delete commands for your branch |
| Trying `ship` or `rescope` safely | add `--dry-run`: it prints what it would do and changes nothing |
| Who is working on what | `node scripts/coord/coord.js status` |

## Working rules

- **Never push to `main`.** Work on your own branch, in your own worktree. `git config core.hooksPath .githooks` turns on a pre-push guard that refuses pushes to `main`; it is once per clone, so in a fresh Codex clone run it at the start of every session.
- **Merge only your own PRs**, one at a time, after CI is green on the PR's current head commit, and only when `check --merge` is clear. Never merge, push to, close or rebase the other partner's branch or PR.
- **Stage by explicit path** (`git add -- <path>`). Never `git add -A` or `git add .`.
- **Pull-request titles** that `start` opens read `<type>: <title> (<ID>)`, with the type taken from the branch prefix (`fix/`, `feat/`, `docs/`, `chore/`; `design/` counts as `feat`). Squash merges use the title as the commit message, so keep it that way.
- **A branch you push to `origin` with commits older than 14 days and no open PR** can stay invisible to a fresh clone of the other partner; open the draft PR first.
- **Keep `TASKS.md` and `WORK_LEDGER.md` committed in the task worktree** before `ship`, `rescope` or a resumed `start`: the engine refuses while either has uncommitted changes, so a claim commit never carries other edits.
- **Claims made within ten minutes of each other count as a tie,** and a tie stops both: the two partners decide who goes first.
- **Your section only.** Edit `WORK_LEDGER.md` only through the engine, and only your own section. Owner-only paths (`.claude/**`, `docs/design-v2/pages/**`, `docs/plans/WAVE4_STATE.md`) are Malede's.
- **New TASKS IDs** come from your own block, `900` to `999` in every prefix (for example `BE-900`), never from the header's "Next free IDs".
- **Production is the owner's.** Atlas, Railway variables, store consoles and secrets are changed only by Malede.
- **Commits** are one short line, with no body and no trailers. Never add AI or assistant attribution anywhere: commits, PRs, code, comments or docs.
