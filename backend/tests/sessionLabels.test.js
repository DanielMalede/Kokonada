'use strict';

const { sessionLabel, RETIRED_ACTIVITY_LABEL } = require('../app/services/sessionLabels');

describe('sessionLabel (defect D-3 — History nomenclature)', () => {
  // RETIRED 2026-09-30 by the owner's ruling on HX-7 (reversal of this pin signed): the fixture was
  // the retired 'working' chip, whose label is now relabelled (below). Moved to a chip still offered.
  it('maps a preset moodKey to a friendly title + manual source', () => {
    expect(sessionLabel('energize', 'running')).toEqual({
      title: 'Peak Energy', source: 'manual', activityLabel: 'Running',
    });
  });

  it('the "Run -> unwind" case: title is the mood, but the chosen chip is surfaced as activityLabel', () => {
    expect(sessionLabel('unwind', 'running')).toEqual({
      title: 'Unwind', source: 'manual', activityLabel: 'Running',
    });
  });

  it('maps a bio:<band>:<activity> key to a friendly band title + live source + activity', () => {
    expect(sessionLabel('bio:peak:running', null)).toEqual({
      title: 'Peak Energy', source: 'live', activityLabel: 'Running',
    });
    expect(sessionLabel('bio:active:walking', null)).toEqual({
      title: 'Active', source: 'live', activityLabel: 'Walking',
    });
  });

  it('drops the "unknown" activity placeholder from a bio key', () => {
    expect(sessionLabel('bio:resting:unknown', null)).toEqual({
      title: 'Resting', source: 'live', activityLabel: null,
    });
  });

  it('never renders a raw/unknown key verbatim — falls back to a titled label', () => {
    expect(sessionLabel('weird_key', null).title).toBe('Weird Key');
    expect(sessionLabel(null, 'running')).toEqual({
      title: 'Running', source: 'manual', activityLabel: 'Running',
    });
    expect(sessionLabel(null, null).title).toBe('Session');
  });
});

// HX-7(c), DEC-062: the Working chip is retired, but rows saved with it keep their stored activity.
// Installed builds render the server's title and activityLabel verbatim, so the server relabels them.
describe('sessionLabel relabels a retired Working activity (display only)', () => {
  it('the neutral label is the designer\'s word, "General", and names no work or study context', () => {
    expect(RETIRED_ACTIVITY_LABEL).toBe('General');
    expect(RETIRED_ACTIVITY_LABEL.trim()).not.toBe('');
    expect(RETIRED_ACTIVITY_LABEL).not.toMatch(/work|study|focus|cod|read|office|job/i);
  });

  it.each(['working', 'Working', ' WORKING ', 'working\n'])('activityLabel for %j is the neutral label', (activity) => {
    expect(sessionLabel('energize', activity)).toEqual({
      title: 'Peak Energy', source: 'manual', activityLabel: RETIRED_ACTIVITY_LABEL,
    });
  });

  it('with no moodKey the title is the neutral label too, never "Working"', () => {
    expect(sessionLabel(null, 'working')).toEqual({
      title: RETIRED_ACTIVITY_LABEL, source: 'manual', activityLabel: RETIRED_ACTIVITY_LABEL,
    });
  });

  it('a bio key that carries working is relabelled the same way', () => {
    expect(sessionLabel('bio:active:working', null)).toEqual({
      title: 'Active', source: 'live', activityLabel: RETIRED_ACTIVITY_LABEL,
    });
  });

  it('nothing in the result says Working, for any path', () => {
    for (const [key, act] of [['energize', 'working'], [null, 'working'], ['', 'Working'], ['bio:peak:working', null], ['bio:peak:unknown', 'working']]) {
      expect(JSON.stringify(sessionLabel(key, act))).not.toMatch(/working/i);
    }
  });

  it('other activities are untouched', () => {
    expect(sessionLabel('calm', 'winding down').activityLabel).toBe('Winding Down');
    expect(sessionLabel(null, 'running').title).toBe('Running');
  });
});
