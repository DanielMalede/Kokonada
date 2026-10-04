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

  it('names the real release JS task scan as clause B 6a (round 2, architect), recorded as an amendment', () => {
    const body = qa.slice(qa.indexOf('### QA-077'));
    const b = body.slice(body.indexOf('**B. In CI, whenever'), body.indexOf('**C. In every Gradle build'));
    expect(b).toContain('6a. The real `:app:createBundleReleaseJsAndAssets` output (the Hermes bundle, the packager and compiler maps, and the composed map) exists, is non-empty, and holds no lab marker.');
    expect(b.indexOf('6a. ')).toBeGreaterThan(b.indexOf('6. '));
    expect(qa).toMatch(/added: 'pass rule clause B 6a: [^']+' source: 'V1 lab round-2 review, architect/);
  });

  it('says that lab evidence never stands for release evidence, and what controls iOS until its guard lands', () => {
    expect(qa).toContain('Lab-variant evidence (`buildType: lab`) never satisfies a release-evidence clause (QA-031).');
    expect(qa).toContain("Clause A1's iOS part closes with the store-gate PR; until then clause D9's IPA scan is the iOS control.");
  });
});

describe('CMP-141: the Design Lab is absent from every uploaded build (compliance-auditor, round 1)', () => {
  const cmp = () => flat(read('CMP-141'));
  const index = () => flat(fs.readFileSync(path.join(REGISTRY, 'INDEX.md'), 'utf8'));

  it('is a P0 prohibition scoped to every Play track, internal app sharing included, and to TestFlight', () => {
    expect(cmp()).toContain('### CMP-141 · The Design Lab is absent from every uploaded build');
    expect(cmp()).toContain('- kind: PROHIBITION');
    expect(cmp()).toContain('Play Console (any track, internal app sharing included) or App Store Connect (TestFlight included)');
    expect(cmp()).toContain('- severity if broken: P0');
  });

  it('is verified where the checks really run, with the iOS control until the store-gate PR', () => {
    for (const check of ['node scripts/lab/assertLabExcluded.mjs', 'node scripts/lab/assertManifests.mjs', 'positive control', 'createBundleReleaseJsAndAssets', '--scan']) {
      expect(cmp()).toContain(check);
    }
    expect(cmp()).toContain('No iOS archive is exported for upload, and nothing goes to TestFlight or App Store Connect, until the store-gate PR is merged and the IPA scan exits 0.');
  });

  it('quotes Apple 2.2 as it reads today ("should be intended")', () => {
    expect(cmp()).toContain('should be intended for public distribution');
  });

  it('is counted and listed in the registry index', () => {
    expect(index()).toContain('CMP 141');
    expect(index()).toContain('Total 458');
    expect(index()).toContain('| [CMP-141](CMP-141.md) | The Design Lab is absent from every uploaded build | PROHIBITION | SETTLED | P0 |');
  });
});
