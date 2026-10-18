'use strict';

// OPS-221, OPS-222 · the coordinator's GitHub CLI adapter (scripts/coord/lib/gh.js), on the exact
// arguments it hands gh.
//
// `COORD_GH` names a script to run in gh's place. Here it is a recording fake: it appends the
// arguments it was called with to a log beside itself, and answers from a reply file there, so a
// test sees exactly what gh would have been asked and decides what gh answers. The adapter stays raw
// (the engine judges truncation on raw lengths), except that openPrFor picks a PR.

const fs = require('fs');
const os = require('os');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const gh = require(path.join(REPO_ROOT, 'scripts', 'coord', 'lib', 'gh.js'));

const FIELDS = 'number,state,headRefName,headRefOid,isDraft,author,isCrossRepository';

const FAKE = `'use strict';
const fs = require('fs');
const path = require('path');
fs.appendFileSync(path.join(__dirname, 'calls.jsonl'), JSON.stringify(process.argv.slice(2)) + '\\n');
const reply = JSON.parse(fs.readFileSync(path.join(__dirname, 'reply.json'), 'utf8'));
process.stdout.write(reply.stdout);
process.exit(reply.code);
`;

let dir;
let saved;
const reply = ({ code = 0, stdout = '' }) => fs.writeFileSync(path.join(dir, 'reply.json'), JSON.stringify({ code, stdout }));
const answer = (list) => reply({ stdout: JSON.stringify(list) });
const calls = () => {
  const file = path.join(dir, 'calls.jsonl');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coord gh '));
  fs.writeFileSync(path.join(dir, 'fake gh.js'), FAKE);
});

afterAll(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

// jest --runInBand runs every file in one process, so COORD_GH is put back exactly as it was.
beforeEach(() => {
  saved = Object.prototype.hasOwnProperty.call(process.env, 'COORD_GH') ? process.env.COORD_GH : undefined;
  process.env.COORD_GH = path.join(dir, 'fake gh.js');
  fs.rmSync(path.join(dir, 'calls.jsonl'), { force: true });
  answer([]);
});

afterEach(() => {
  if (saved === undefined) delete process.env.COORD_GH;
  else process.env.COORD_GH = saved;
});

describe('OPS-221 · gh.js — the PR lists', () => {
  test('(18) prListOpen asks for every open PR up to 100, with isCrossRepository, and never --author', () => {
    expect(gh.prListOpen(dir)).toEqual([]);
    expect(calls()).toEqual([['pr', 'list', '--state', 'open', '--limit', '100', '--json', FIELDS]]);
  });

  test('(19) prList asks for PRs of every state up to 300, with isCrossRepository, and never --author', () => {
    expect(gh.prList(dir)).toEqual([]);
    expect(calls()).toEqual([['pr', 'list', '--state', 'all', '--limit', '300', '--json', FIELDS]]);
  });

  test('(20) prListOpenBy asks for one person\'s open PRs up to 100, with --author', () => {
    const his = [{ number: 7, state: 'OPEN', headRefName: 'feat/b', headRefOid: 'a'.repeat(40), isDraft: true, author: { login: 'DanielBedrack' }, isCrossRepository: false }];
    answer(his);
    expect(gh.prListOpenBy(dir, 'DanielBedrack')).toEqual(his);
    expect(calls()).toEqual([['pr', 'list', '--state', 'open', '--author', 'DanielBedrack', '--limit', '100', '--json', FIELDS]]);
  });

  test('(21) prListOpenBy refuses anything that is not a GitHub login, before gh runs: no search qualifier, no flag', () => {
    for (const login of ['x is:closed', '-x', 'x-', '', 'a'.repeat(40)]) {
      expect({ login, list: gh.prListOpenBy(dir, login) }).toEqual({ login, list: null });
    }
    expect(calls()).toEqual([]);
    // the longest login GitHub allows still runs
    expect(gh.prListOpenBy(dir, 'a'.repeat(39))).toEqual([]);
    expect(calls()).toHaveLength(1);
  });

  test('a list gh could not give is null, never an empty list', () => {
    reply({ code: 1, stdout: '' });
    expect(gh.prListOpen(dir)).toBeNull();
    expect(gh.prList(dir)).toBeNull();
    expect(gh.prListOpenBy(dir, 'DanielMalede')).toBeNull();
  });
});

describe('OPS-222 · gh.js — openPrFor', () => {
  test('(22) asks for the open PRs from that head into main, and takes the first from this repository', () => {
    answer([
      { number: 9, url: 'https://github.example/pull/9', isCrossRepository: true },
      { number: 5, url: 'https://github.example/pull/5', isCrossRepository: false },
    ]);
    expect(gh.openPrFor(dir, 'fix/x')).toEqual({ number: 5, url: 'https://github.example/pull/5', isCrossRepository: false });
    expect(calls()).toEqual([['pr', 'list', '--head', 'fix/x', '--base', 'main', '--state', 'open', '--limit', '100', '--json', 'number,url,isCrossRepository']]);
  });

  test('(22) only forks\' PRs, a PR that does not say which it is, or gh failing: no PR', () => {
    answer([{ number: 9, url: 'https://github.example/pull/9', isCrossRepository: true }]);
    expect(gh.openPrFor(dir, 'fix/x')).toBeNull();
    answer([{ number: 5, url: 'https://github.example/pull/5' }]);
    expect(gh.openPrFor(dir, 'fix/x')).toBeNull();
    reply({ code: 1, stdout: '' });
    expect(gh.openPrFor(dir, 'fix/x')).toBeNull();
  });
});
