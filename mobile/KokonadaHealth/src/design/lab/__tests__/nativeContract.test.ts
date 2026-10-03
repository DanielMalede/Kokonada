/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { LAB_EVENTS, LAB_PROPS } from '../LabRoot';

// MB-085. The lab activity (Kotlin) and the lab runtime (JS) meet at a handful of names: the launch
// options the activity passes as initial props, and the device events it sends. A rename on one side
// alone would make the lab start with no arguments or never hear a command, and nothing would fail
// until a capture timed out on the phone. So the names are pinned to each other here.

const APP = path.resolve(__dirname, '../../../..');
const kotlin = fs.readFileSync(path.join(APP, 'android/app/src/lab/java/com/kokonadahealth/lab/DesignLabActivity.kt'), 'utf8');

describe('the lab activity and the lab runtime use the same names', () => {
  it.each(Object.entries(LAB_PROPS))('launch option %s is "%s" on both sides', (_key, name) => {
    expect(kotlin).toContain(`"${name}"`);
  });

  it.each(Object.entries(LAB_EVENTS))('device event %s is "%s" on both sides', (_key, name) => {
    expect(kotlin).toContain(`"${name}"`);
  });

  it('forces right-to-left before React starts (before super.onCreate), as F-13 requires', () => {
    const onCreate = kotlin.slice(kotlin.indexOf('override fun onCreate'));
    const force = onCreate.indexOf('forceRTL(this, true)');
    const superCall = onCreate.indexOf('super.onCreate(');
    expect(force).toBeGreaterThan(-1);
    expect(superCall).toBeGreaterThan(force);
  });
});
