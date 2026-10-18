/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';

// MB-084 (round-1 review, N3). Uploads are manual: no workflow uploads anything. So until the G11
// release harness exists (OPS-028, OPS-030), the scan of the EXACT artifact to be uploaded is a line
// in the pre-upload checklists, with its evidence (the artifact's name, its SHA-256, exit 0). This
// pins the line in each checklist, so it cannot drop out unnoticed.

const REPO = path.resolve(__dirname, '../../../../..');
const CHECKLISTS = ['docs/store/play-health-connect-declaration.md', 'docs/privacy-declarations.md'];

describe('every pre-upload checklist requires the exact-artifact lab scan', () => {
  it.each(CHECKLISTS)('%s', (file) => {
    const line = fs.readFileSync(path.join(REPO, file), 'utf8').split(/\r?\n/)
      .find((l) => l.includes('node scripts/lab/assertLabExcluded.mjs --scan'));
    expect(line).toBeDefined();
    expect(line).toMatch(/^- \[ \] /); // an unchecked checklist item, not prose
    expect(line).toMatch(/SHA-256/);
    expect(line).toMatch(/exit 0/);
    expect(line).toMatch(/internal app sharing/);
  });
});
