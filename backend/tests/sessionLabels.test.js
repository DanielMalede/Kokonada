'use strict';

const { sessionLabel } = require('../app/services/sessionLabels');

describe('sessionLabel (defect D-3 — History nomenclature)', () => {
  it('maps a preset moodKey to a friendly title + manual source', () => {
    expect(sessionLabel('energize', 'working')).toEqual({
      title: 'Peak Energy', source: 'manual', activityLabel: 'Working',
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
