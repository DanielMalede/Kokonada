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
- **Identity is the GitHub login** (`gh api user --jq .login`), never a first name. Both partners are named Daniel; elsewhere in this repository "Daniel" means Malede, the owner.

## Start a task

1. **Find the task.**
   - A TASKS task: search its ID in `git show origin/main:TASKS.md` and read the title, every `where:` path, `done when:` and any `- status:` line. A row already taken on a live branch is a collision.
   - An own task: name it `own:<short-slug>`.
   - `DAN-` rows are the owner's alone. Never claim one.
2. **Derive the exact path set.** Start from the `where:` paths. For each file, add what moves with it: its importers and importees, and every test that names it (search `backend/tests/` and `mobile/KokonadaHealth/**/__tests__/`). Add the tests you will create, and any new folder as a narrow glob with at least two literal segments (`project-explorer/**` is fine; `backend/**`, `docs/**` and `**` are refused). Declare files, not whole areas.
3. **Add resources** if the task touches something that is not a file: `res:atlas-prod`, `res:railway-vars`, `res:store-android`, `res:store-ios`, `res:secrets`. These are normally the owner's.
4. **Check:**
   ```
   node scripts/coord/coord.js check --task <ID|own:slug> --paths <p1,p2,...> [--resources <r1,...>]
   ```
   Exit 0 CLEAR · 3 WARN · 1 HALT · 2 CANNOT VERIFY.
5. **On CLEAR (or WARN you have reported), claim:**
   ```
   node scripts/coord/coord.js start --task <ID|own:slug> --title "<one line>" --paths <...> [--resources <...>] --branch <prefix>/<id>-<slug>
   ```
   It creates a worktree from `origin/main` (by default `.worktree-<branch>` at the repo root), fills your next free slot in your section of the ledger, writes the TASKS marker, commits by path with `[skip ci]`, pushes, re-checks for a race and opens a **draft PR**. If it stops half way, run the same command again; every step resumes.
6. **Work only inside that worktree, and only on the declared paths.**

## On HALT

Stop. Do not touch the files, do not retry with a narrower set to get past it, and do not work "carefully" on a shared file. Report:
- what the task is and the paths you declared;
- what it meets: the partner, his branch, his slot, the file, and the class (exact, glob, exclusive group, coupled file, resource, task, unclaimed branch);
- the options: wait until his PR merges and claim then; split the work so the files are disjoint; or both partners agree in writing on a shared file.

The earlier claim holds. The humans decide; the engine and you never do.

## During and after

| When | Run |
|---|---|
| The task needs a file it did not declare | `node scripts/coord/coord.js rescope --paths <full new set>` in the task worktree, **before** touching the file |
| Ready for review | `node scripts/coord/coord.js ship` in the task worktree, then `gh pr edit --body-file <file>` and `gh pr ready` |
| Before merging | `node scripts/coord/coord.js check --merge <PR number>` |
| Dropping the task | `node scripts/coord/coord.js release` prints the close and delete commands for your branch |
| Who is working on what | `node scripts/coord/coord.js status` |

## Working rules

- **Never push to `main`.** Work on your own branch, in your own worktree. A one-time `git config core.hooksPath .githooks` turns on a pre-push guard that refuses pushes to `main`.
- **Merge only your own PRs**, one at a time, after CI is green on the PR's current head commit, and only when `check --merge` is clear. Never merge, push to, close or rebase the other partner's branch or PR.
- **Stage by explicit path** (`git add -- <path>`). Never `git add -A` or `git add .`.
- **Your section only.** Edit `WORK_LEDGER.md` only through the engine, and only your own section. Owner-only paths (`.claude/**`, `docs/design-v2/pages/**`, `docs/plans/WAVE4_STATE.md`) are Malede's.
- **New TASKS IDs** come from your own block, `900` to `999` in every prefix (for example `BE-900`), never from the header's "Next free IDs".
- **Production is the owner's.** Atlas, Railway variables, store consoles and secrets are changed only by Malede.
- **Commits** are one short line, with no body and no trailers. Never add AI or assistant attribution anywhere: commits, PRs, code, comments or docs.
