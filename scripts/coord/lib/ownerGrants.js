'use strict';

// OPS-187: owner-approved grants, deliberately in the reviewed engine, not a candidate ledger.
// WORK_LEDGER.md keeps .claude/** protected and its header stays owner-only. The existing OPS
// delegation is recorded in that header and TASKS.md; the replacement #240 delegation is at
// https://github.com/DanielMalede/Kokonada/pull/240#issuecomment-6061466986.
// Each OPS row grants only its own where: files, not the union of all delegated work.
const { overlapClass } = require('./paths');
const { findOpenRow } = require('./tasks');

const grants = new Map([
  ['OPS-178', ['TASKS', ['.claude/agents/merge-guard.md', '.claude/commands/review-pr.md']]],
  ['OPS-182', ['TASKS', ['.claude/agents/merge-guard.md']]],
  ['OPS-183', ['TASKS', ['.claude/commands/merge.md']]],
  ['OPS-184', ['TASKS', ['.claude/commands/review-pr.md']]],
  ['OPS-185', ['TASKS', ['.claude/agents/merge-guard.md']]],
  ['OPS-186', ['TASKS', ['.claude/commands/merge.md']]],
  ['own:resilience-auditor-max-2', ['own', [
    '.claude/agents/resilience-auditor.md', '.claude/agents/merge-guard.md',
    '.claude/commands/ship.md', '.claude/commands/review-pr.md',
  ]]],
]);

// Pure, fail closed. Callers pass one unambiguous, non-malformed live claim, or null.
// A TASKS grant dies when its row closes on CURRENT main, not a stale merge-base.
function ownerOnlyHits({ rules, person, claim, paths, mainTasks }) {
  if (person.isOwner) return [];
  const grant = claim && !claim.malformed && String(person.login).toLowerCase() === 'danielbedrack'
    ? grants.get(claim.task) : null;
  const permitted = grant && claim.taskKind === grant[0]
    && (grant[0] === 'own' || findOpenRow(mainTasks || '', claim.task)) ? grant[1] : [];
  return (paths || []).filter((raw) => {
    // Callers already canonicalize declarations and Git separators. Actual Git names may contain
    // commas, backticks or trailing spaces: never trim or apply declaration-only validation here.
    const file = String(raw);
    // A newline must not evade a protected glob's RegExp dot; this spelling is for classification
    // only. The grant still compares the exact original filename and cannot borrow this alias.
    const matchPath = file.replace(/[\u0000-\u001f\u007f\u2028\u2029]/g, '\ufffd');
    if (!(rules.ownerOnly || []).some((pattern) => overlapClass(matchPath, pattern))) return false;
    // Never subtract a literal allowance from a wildcard or a folder claim.
    return file.includes('*') || !permitted.some((p) => p.toLowerCase() === file.toLowerCase());
  });
}

module.exports = { ownerOnlyHits };
