'use strict';

// Output for humans and for CI. PURE: data in, text out.

// Text output lists at most this many files, then "+N more"; JSON output always carries them all.
const MAX_LISTED = 6;

function shortTicks(list, max = MAX_LISTED) {
  const items = (list || []).map((x) => `\`${x}\``);
  if (items.length <= max) return items.join(', ');
  return `${items.slice(0, max).join(', ')} +${items.length - max} more`;
}

const USAGE = `usage: node scripts/coord/coord.js <command> [options]

Two partners, one repository: claim files before you touch them, so neither overwrites the other.
Live claims are read from WORK_LEDGER.md on every branch on origin (the copy on main is history).

commands
  check   --paths a,b,c [--resources r1,r2] [--task ID|own:slug] [--merge N] [--json]
          Does this work collide with the other partner's live claims or unclaimed recent branches?
          --merge N: may I merge PR N now (my own PR, no deploy in flight), and whom will it affect?
  start   --task ID|own:slug --title "..." --paths a,b,c [--resources r1,r2] --branch <name>
          [--dir <path>] [--dry-run]
          Check, take a ledger slot, mark the TASKS row, cut a worktree from origin/main, commit the
          claim, push it, and open a draft PR. An existing branch name is used only to resume your
          own claim: on origin, or a local one a failed push left behind; a name main's ledger
          records is never reused. --dir is relative to the repository root (default:
          <root>/.worktree-<branch with / as ->).
  status  [--json]
          Both sections: live claims (slot, task, branch, paths, state, PR, age, drift, behind main)
          and unclaimed recent branches.
  ship    [--pr N] [--dry-run]          (inside the task worktree) mark the slot in review
  rescope --paths a,b,c [--dry-run]     (inside the task worktree) re-check and replace the paths
  release                               (inside the task worktree) print the commands that drop it
          ship, rescope and a resumed start commit only their own ledger lines, so they refuse
          while TASKS.md or WORK_LEDGER.md has uncommitted changes in the task worktree.
  ci      --branch <b> --author <login> [--mode warn|fail]
          The server-side gate for a pushed branch (git plus GitHub PR state).

exit codes
  0 CLEAR · 3 WARN · 1 HALT or FAIL · 2 cannot verify (no fetch, shallow clone, unknown or
  mismatched login, a ledger header that does not parse, gh missing or failing where it is
  required: check, check --merge, start and rescope)

identity
  COORD_LOGIN if set, else \`gh api user --jq .login\`, mapped through the People table. When both
  answer they must name the same login.
`;

function renderReasons(reasons) {
  return reasons.map((r) => `  ${r.level} [${r.class}] ${r.message}`).join('\n');
}

function renderCheck(result, { otherName, counted }) {
  const lines = [];
  const n = result.reasons.length;
  if (result.verdict === 'CLEAR') {
    lines.push(`CLEAR — nothing of ${otherName}'s live work meets yours (${counted.claims} live claim(s), ${counted.unclaimed} unclaimed recent branch(es) checked)`);
  } else {
    lines.push(`${result.verdict} — ${n} reason${n === 1 ? '' : 's'}`);
    lines.push(renderReasons(result.reasons));
  }
  return `${lines.join('\n')}\n`;
}

const ticks = (list) => shortTicks(list);

function prText(pr) {
  if (!pr) return 'PR: none found';
  if (pr.unknown) return 'PR: unknown (gh unavailable)';
  return `PR #${pr.number} (${String(pr.state).toLowerCase()}${pr.isDraft ? ', draft' : ''})`;
}

// view: { people: [{ name, login, section, claims: [...], unclaimed: [...] }], unknown: [...],
//         freeze: [{ person, login, slot, branch, task }] } — an active production freeze comes first.
function renderStatus(view) {
  const out = [];
  const freeze = view.freeze || [];
  for (const f of freeze) {
    const holder = f.person ? `${f.person} (@${f.login})` : 'owner unknown';
    out.push(`production freeze: held by ${holder} on ${f.branch} (${f.slot || 'no slot'}, ${f.task || 'no task'}) — check --merge refuses every merge to main while it is held`);
  }
  if (freeze.length) out.push('');
  for (const person of view.people) {
    out.push(`== ${person.name} (@${person.login}) — section ${person.section} ==`);
    if (!person.claims.length) out.push('  no live claims');
    for (const c of person.claims) {
      out.push(`  ${[c.slot || '(no slot)', c.task || '(no task)', c.title || ''].join('  ').trimEnd()}`);
      const state = c.malformed ? 'its ledger slot does not parse' : c.state === 'in-review' ? `in review (PR #${c.pr})` : 'claimed';
      out.push(`      branch ${c.branch} · ${state} · ${prText(c.prInfo)} · last commit ${c.age}${c.behindMain ? ' · behind main' : ''}`);
      out.push(`      paths: ${ticks(c.paths)}${c.resources.length ? ` · resources: ${ticks(c.resources)}` : ''}`);
      if (c.drift.length) out.push(`      drift (changed, not claimed): ${ticks(c.drift)}`);
    }
    if (person.unclaimed.length) {
      out.push('  unclaimed recent branches:');
      for (const u of person.unclaimed) {
        out.push(`    ${u.branch} · ${u.age} · ${prText(u.prInfo)} · changes: ${u.files.length ? ticks(u.files) : '(nothing)'}`);
      }
    }
    out.push('');
  }
  if (view.unknown.length) {
    out.push('== owner unknown (author maps to nobody in People) ==');
    for (const u of view.unknown) {
      out.push(`    ${u.branch} · ${u.author} · ${u.age} · changes: ${u.files.length ? ticks(u.files) : '(nothing)'}`);
    }
    out.push('');
  }
  return `${out.join('\n').replace(/\n+$/, '')}\n`;
}

function renderCi(result, { branch, author }) {
  const head = `ci ${branch} by @${author}: ${result.verdict}`;
  return result.reasons.length ? `${head}\n${renderReasons(result.reasons)}\n` : `${head}\n`;
}

function ciMarkdown(result, { branch, author }) {
  const lines = [`### Work ledger — \`${branch}\` by @${author}: ${result.verdict}`, ''];
  if (!result.reasons.length) {
    lines.push('The branch holds a live claim, stays inside it, and meets nobody else\'s work.');
  } else {
    lines.push('| level | class | detail |', '|---|---|---|');
    for (const r of result.reasons) lines.push(`| ${r.level} | ${r.class} | ${String(r.message).replace(/\|/g, '\\|')} |`);
  }
  return `${lines.join('\n')}\n\n`;
}

module.exports = { MAX_LISTED, shortTicks, USAGE, renderReasons, renderCheck, renderStatus, renderCi, ciMarkdown };
