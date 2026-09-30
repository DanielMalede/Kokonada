/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import * as vm from 'vm';
import { ACTIVITIES, RETIRED_ACTIVITY_KEYS } from '../activities';

// HX-7 resilience round 1: the server admits an emotion_update activity only from the chips the app
// offers. The two lists live in two packages, so this runs the real backend module (untransformed, in a
// Node vm: it has no imports) and holds them equal. A chip added or retired on one side only fails here.
const file = path.resolve(__dirname, '../../../../../../backend/app/services/chipActivities.js');
const loadServer = () => {
  const mod = { exports: {} as any };
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module: mod, exports: mod.exports }, { filename: file });
  return mod.exports;
};

describe('the server admits exactly the chips the app offers', () => {
  it('the server chip keys equal the app ACTIVITIES keys', () => {
    expect([...loadServer().CHIP_ACTIVITY_KEYS].sort()).toEqual(ACTIVITIES.map((a) => a.key).sort());
  });

  it('no retired key is admitted by the server', () => {
    const server: string[] = [...loadServer().CHIP_ACTIVITY_KEYS];
    for (const k of RETIRED_ACTIVITY_KEYS) expect(server).not.toContain(k);
  });
});
