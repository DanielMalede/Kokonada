/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';

// MB-084 (round-1 review). The registry entries the Design Lab answers to, pinned to the wording the
// reviewers settled, so the requirement and the checks that enforce it cannot drift apart silently.

const REGISTRY = path.resolve(__dirname, '../../../../../docs/design-v2/registry');
const read = (id: string) => fs.readFileSync(path.join(REGISTRY, `${id}.md`), 'utf8');
const flat = (s: string) => s.replace(/\s+/g, ' ');

describe('QA-077: the restated pass rule (resilience-auditor, V1 lab round 1, section 7)', () => {
  const qa = flat(read('QA-077'));

  it('is recorded as an amendment of 2026-10-04, with its source', () => {
    expect(qa).toMatch(/amended: 2026-10-04/);
    expect(qa).toContain('· Amended 2026-10-04:');
  });

  it('holds the four clause groups and the scan as a direct node call', () => {
    for (const group of ['A. On every PR, in CI, with no path filter', 'B. In CI, whenever', 'C. In every Gradle build, whatever the route', 'D. Before every upload']) {
      expect(qa).toContain(group);
    }
    // The body uses the direct call; only the front matter's provenance note names the substituted text.
    const body = qa.slice(qa.indexOf('### QA-077'));
    expect(body).toContain('node scripts/lab/assertLabExcluded.mjs --scan');
    expect(body).not.toContain('lab:excluded');
  });

  it('says that lab evidence never stands for release evidence, and what controls iOS until its guard lands', () => {
    expect(qa).toContain('Lab-variant evidence (`buildType: lab`) never satisfies a release-evidence clause (QA-031).');
    expect(qa).toContain("Clause A1's iOS part closes with the store-gate PR; until then clause D9's IPA scan is the iOS control.");
  });
});
