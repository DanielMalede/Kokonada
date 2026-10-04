/// <reference types="node" />
import * as fs from 'fs';
import * as path from 'path';
import { LAB_EVENTS, LAB_PROPS } from '../LabRoot';

// MB-085. The lab activity (Kotlin) and the lab runtime (JS) meet at a handful of names: the launch
// options the activity passes as initial props, and the device events it sends. A rename on one side
// alone would make the lab start with no arguments or never hear a command, and nothing would fail
// until a capture timed out on the phone. So the names are pinned to each other here, at their CALL
// SITES in the Kotlin code, with comments stripped first: a name that survives only in a comment
// proves nothing (the round-1 review's MF-3).

const APP = path.resolve(__dirname, '../../../..');
const code = fs.readFileSync(path.join(APP, 'android/app/src/lab/java/com/kokonadahealth/lab/DesignLabActivity.kt'), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\/\/[^\n]*/g, '');

describe('the lab activity and the lab runtime use the same names', () => {
  it('the comment-stripped code still holds the activity (the strip did not empty it)', () => {
    expect(code).toContain('class DesignLabActivity');
  });

  it.each([
    ['labArgs', `putBundle("${LAB_PROPS.args}"`],
    ['nonStringKeys', `putStringArrayList("${LAB_PROPS.nonStringKeys}"`],
    ['powerSave', `putBoolean("${LAB_PROPS.powerSave}"`],
  ])('launch option %s is put by the activity under the name LabRoot reads', (_name, callSite) => {
    expect(code).toContain(callSite);
  });

  it.each([
    ['command', `emit("${LAB_EVENTS.command}"`],
    ['power save', `emit("${LAB_EVENTS.powerSave}"`],
  ])('the %s event is emitted under the name LabRoot listens for', (_name, callSite) => {
    expect(code).toContain(callSite);
  });

  it('a command carries its extras as "args" and "nonStringKeys", the keys LabRoot reads', () => {
    expect(code).toContain('putMap("args"');
    expect(code).toContain('putArray("nonStringKeys"');
  });

  it('forces right-to-left before React starts (before super.onCreate), as F-13 requires', () => {
    const onCreate = code.slice(code.indexOf('override fun onCreate'));
    const force = onCreate.indexOf('forceRTL(this, true)');
    const superCall = onCreate.indexOf('super.onCreate(');
    expect(force).toBeGreaterThan(-1);
    expect(superCall).toBeGreaterThan(force);
  });
});
