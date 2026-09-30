'use strict';

// Structural guard for the backend's Node.js runtime.
//
// The backend's Node version is stated in two places, and they have to agree:
//
//   · backend/Dockerfile — the image Railway builds and runs in production (ci.yml, the note
//     at the end of the file: Root Directory = /backend, Railway builds backend/Dockerfile);
//   · .github/workflows/ci.yml, job `backend` — the runtime the backend suite is tested on,
//     and the gate Railway's "wait for CI" waits for before it deploys.
//
// If they drift, CI goes green on a runtime production does not run, so the green says
// nothing about the deployed build.
//
// WHY 24. Node 20 reached end-of-life on 2026-04-30 and gets no more security releases.
// Node 24 is the active LTS line: maintenance from 2026-10-20, end-of-life 2028-04-30
// (https://github.com/nodejs/Release/blob/main/schedule.json). Moving off 24 is a deliberate
// change: update this constant with the Dockerfile and the CI job, in the same commit.
//
// The last test checks that the parser still finds the real lines, so the guard cannot pass
// by parsing nothing.

const fs = require('fs');
const path = require('path');

const BACKEND_NODE_MAJOR = 24;

const REPO_ROOT = path.join(__dirname, '..', '..');
const DOCKERFILE = path.join(REPO_ROOT, 'backend', 'Dockerfile');
const CI_WORKFLOW = path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml');

const readLines = (file) => fs.readFileSync(file, 'utf8').split(/\r?\n/);
const indentOf = (line) => line.match(/^ */)[0].length;
const isSkippable = (line) => /^\s*(#.*)?$/.test(line);

// `FROM [--platform=…] node:<major>[.<minor>[.<patch>]]-[<debian>-]slim[@sha256:…] [AS name]`
const NODE_FROM = /^FROM\s+(?:--platform=\S+\s+)?node:(\d+)(?:\.\d+){0,2}-(?:[a-z]+-)?(slim)(?:@sha256:[0-9a-f]{64})?(?:\s+AS\s+\S+)?\s*$/i;

// The runtime stage is the LAST `FROM` — in a multi-stage build the earlier ones only build.
function dockerRuntimeImage() {
  const froms = readLines(DOCKERFILE).filter((l) => /^\s*FROM\s/i.test(l)).map((l) => l.trim());
  const runtime = froms[froms.length - 1];
  const m = runtime ? runtime.match(NODE_FROM) : null;
  return {
    fromLines: froms,
    runtime,
    major: m ? Number(m[1]) : null,
    variant: m ? m[2].toLowerCase() : null,
  };
}

// Every line nested under `headerIdx` (indented deeper than it).
function blockIndices(lines, headerIdx) {
  const headerIndent = indentOf(lines[headerIdx]);
  const out = [];
  for (let i = headerIdx + 1; i < lines.length; i += 1) {
    if (isSkippable(lines[i])) continue;
    if (indentOf(lines[i]) <= headerIndent) break;
    out.push(i);
  }
  return out;
}

// Only the direct children of a block, so a nested key that happens to be called `backend:`
// (a paths-filter name, say) is never mistaken for the job.
function directChildIndices(lines, headerIdx) {
  const inner = blockIndices(lines, headerIdx);
  if (inner.length === 0) return [];
  const childIndent = indentOf(lines[inner[0]]);
  return inner.filter((i) => indentOf(lines[i]) === childIndent);
}

// The `node-version` of every `actions/setup-node` step in the `backend` job.
function ciBackendNodeVersions() {
  const lines = readLines(CI_WORKFLOW);
  const jobsIdx = lines.findIndex((l) => /^jobs:\s*(#.*)?$/.test(l));
  if (jobsIdx < 0) return { found: false, versions: [] };
  const jobIdx = directChildIndices(lines, jobsIdx).find((i) => /^\s*backend:\s*(#.*)?$/.test(lines[i]));
  if (jobIdx === undefined) return { found: false, versions: [] };

  const job = blockIndices(lines, jobIdx);
  const versions = [];
  job.forEach((i, k) => {
    if (!/^\s*(- )?uses:\s*actions\/setup-node@/.test(lines[i])) return;
    // The step's own list item starts at or above this line; the step ends at the next list
    // item that is not nested deeper than that one's dash.
    let dash = k;
    while (dash > 0 && !/^\s*- /.test(lines[job[dash]])) dash -= 1;
    const dashIndent = indentOf(lines[job[dash]]);
    for (const j of job.slice(k + 1)) {
      if (/^\s*- /.test(lines[j]) && indentOf(lines[j]) <= dashIndent) break;
      const m = lines[j].match(/^\s*node-version:\s*['"]?([^'"\s#]+)['"]?\s*(#.*)?$/);
      if (m) { versions.push(m[1]); break; }
    }
  });
  return { found: true, versions };
}

const majorOf = (version) => Number(String(version).replace(/^v/, '').split('.')[0]);

describe('backend Node.js runtime pin', () => {
  it(`the production image runs Node ${BACKEND_NODE_MAJOR} on the slim variant`, () => {
    const image = dockerRuntimeImage();
    expect(image.runtime).toMatch(NODE_FROM);
    expect(image.major).toBe(BACKEND_NODE_MAJOR);
    expect(image.variant).toBe('slim');
  });

  it(`the backend CI job tests on Node ${BACKEND_NODE_MAJOR}`, () => {
    const ci = ciBackendNodeVersions();
    expect(ci.versions.map(majorOf)).toStrictEqual([BACKEND_NODE_MAJOR]);
  });

  it('CI tests the backend on the same Node major the production image runs', () => {
    const image = dockerRuntimeImage();
    const ci = ciBackendNodeVersions();
    expect(ci.versions.map(majorOf)).toStrictEqual([image.major]);
  });

  it('finds the real Dockerfile FROM and the real backend setup-node step, so the guard cannot pass vacuously', () => {
    const image = dockerRuntimeImage();
    expect(image.fromLines.length).toBeGreaterThanOrEqual(1);
    expect(image.major).not.toBeNull();

    const ci = ciBackendNodeVersions();
    expect(ci.found).toBe(true);
    expect(ci.versions).toHaveLength(1);
  });
});
