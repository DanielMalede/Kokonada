/// <reference types="node" />
import fs from 'node:fs';
import path from 'node:path';

// OPS-100 (round-1 review, architect: device safety). The lab installs beside the real app on the
// owner's phone. An uninstall aimed one segment short (`com.kokonadahealth` instead of
// `com.kokonadahealth.lab`) would erase the real app with its consent state, tokens and Health
// Connect grants. So every uninstall the lab tooling runs or documents names exactly the lab package.

const LAB = path.resolve(__dirname, '..');
const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
  const full = path.join(dir, e.name);
  if (e.isDirectory()) return e.name === '__tests__' || e.name === '__fixtures__' ? [] : files(full);
  return /\.(mjs|js|ts|md|json)$/.test(e.name) ? [full] : [];
});

describe('every uninstall in the lab tooling names exactly com.kokonadahealth.lab', () => {
  const lines = files(LAB).flatMap((f) => fs.readFileSync(f, 'utf8').split(/\r?\n/)
    .map((line, i) => ({ where: `${path.relative(LAB, f)}:${i + 1}`, line }))
    .filter(({ line }) => /uninstall/i.test(line)));

  it('the README documents the one legitimate uninstall: a lab signature mismatch on adb install -r', () => {
    const readme = fs.readFileSync(path.join(LAB, 'README.md'), 'utf8');
    expect(readme).toContain('adb uninstall com.kokonadahealth.lab');
  });

  // An uninstall site is a command line (`uninstall com.x.y`, `pm uninstall --user 0 com.x.y`) or an
  // argument array (`'uninstall', '-k', 'com.x.y'`). Prose that merely mentions uninstalling is not a
  // site. After the flags, a site must name a literal package: one held in a variable cannot be checked.
  const FLAGS = String.raw`(?:--?[\w-]+\s+(?:\d+\s+)?)*`;
  const ARG_FLAGS = String.raw`(?:['"]--?[\w-]+['"]\s*,\s*(?:['"]?\d+['"]?\s*,\s*)?)*`;
  const sites = lines.flatMap(({ where, line }) => [
    ...[...line.matchAll(new RegExp(String.raw`\b(?:adb|pm|package)\s+uninstall\b(?!['"])\s*${FLAGS}(\S*)`, 'g'))],
    ...[...line.matchAll(new RegExp(String.raw`(?<!(?:adb|pm|package)\s+)\buninstall\s+${FLAGS}([A-Za-z]\w*(?:\.\w+)+)`, 'g'))],
    ...[...line.matchAll(new RegExp(String.raw`['"]uninstall['"]\s*,\s*${ARG_FLAGS}(['"][^'"]*['"]|[^\s,\])]+)`, 'g'))],
  ].map((m) => ({ where, pkg: m[1].replace(/^['"`]|[`'".,;)\]]+$/g, '') })));

  it('every uninstall names exactly the lab package, never the real app and never a variable', () => {
    expect(sites.length).toBeGreaterThan(0); // the scan sees the documented one
    expect(sites.filter(({ pkg }) => pkg !== 'com.kokonadahealth.lab')).toEqual([]);
  });
});
